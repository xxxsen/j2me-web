#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/log.h>
#include <libavutil/mathematics.h>
#include <libswresample/swresample.h>

#define MAX_INPUT_BYTES (32 * 1024 * 1024)
#define MAX_OUTPUT_BYTES (64 * 1024 * 1024)
#define WAV_HEADER_BYTES 44

typedef struct {
    const uint8_t *data;
    int64_t size;
    int64_t position;
} InputBuffer;

typedef struct {
    uint8_t *data;
    int size;
    int capacity;
    int channels;
    int sample_rate;
} OutputBuffer;

static int input_read(void *opaque, uint8_t *target, int target_size) {
    InputBuffer *input = (InputBuffer *) opaque;
    int64_t remaining = input->size - input->position;
    if (remaining <= 0) return AVERROR_EOF;
    if (target_size > remaining) target_size = (int) remaining;
    memcpy(target, input->data + input->position, (size_t) target_size);
    input->position += target_size;
    return target_size;
}

static int64_t input_seek(void *opaque, int64_t offset, int whence) {
    InputBuffer *input = (InputBuffer *) opaque;
    if (whence == AVSEEK_SIZE) return input->size;
    int64_t base = 0;
    switch (whence & ~AVSEEK_FORCE) {
        case SEEK_SET: base = 0; break;
        case SEEK_CUR: base = input->position; break;
        case SEEK_END: base = input->size; break;
        default: return AVERROR(EINVAL);
    }
    if (offset < -base || offset > input->size - base) return AVERROR(EINVAL);
    input->position = base + offset;
    return input->position;
}

static int output_reserve(OutputBuffer *output, int additional) {
    if (!output || additional < 0 || output->size > MAX_OUTPUT_BYTES - additional) return 0;
    int required = output->size + additional;
    if (required <= output->capacity) return 1;
    int capacity = output->capacity > 0 ? output->capacity : 64 * 1024;
    while (capacity < required && capacity <= MAX_OUTPUT_BYTES / 2) capacity *= 2;
    if (capacity < required) capacity = required;
    uint8_t *data = (uint8_t *) realloc(output->data, (size_t) capacity);
    if (!data) return 0;
    output->data = data;
    output->capacity = capacity;
    return 1;
}

static void write_u16(uint8_t *target, uint16_t value) {
    target[0] = (uint8_t) value;
    target[1] = (uint8_t) (value >> 8);
}

static void write_u32(uint8_t *target, uint32_t value) {
    target[0] = (uint8_t) value;
    target[1] = (uint8_t) (value >> 8);
    target[2] = (uint8_t) (value >> 16);
    target[3] = (uint8_t) (value >> 24);
}

static void output_write_header(OutputBuffer *output) {
    uint8_t *header = output->data;
    uint32_t data_size = (uint32_t) (output->size - WAV_HEADER_BYTES);
    uint16_t block_align = (uint16_t) (output->channels * 2);
    memcpy(header, "RIFF", 4);
    write_u32(header + 4, data_size + 36);
    memcpy(header + 8, "WAVEfmt ", 8);
    write_u32(header + 16, 16);
    write_u16(header + 20, 1);
    write_u16(header + 22, (uint16_t) output->channels);
    write_u32(header + 24, (uint32_t) output->sample_rate);
    write_u32(header + 28, (uint32_t) (output->sample_rate * block_align));
    write_u16(header + 32, block_align);
    write_u16(header + 34, 16);
    memcpy(header + 36, "data", 4);
    write_u32(header + 40, data_size);
}

static int append_frame(OutputBuffer *output, SwrContext **resampler, const AVFrame *frame) {
    if (!*resampler) {
        AVChannelLayout output_layout;
        int channels = frame->ch_layout.nb_channels > 1 ? 2 : 1;
        int rate = frame->sample_rate > 0 ? frame->sample_rate : 44100;
        av_channel_layout_default(&output_layout, channels);
        if (swr_alloc_set_opts2(resampler, &output_layout, AV_SAMPLE_FMT_S16, rate,
                                &frame->ch_layout, (enum AVSampleFormat) frame->format,
                                rate, 0, NULL) < 0 || swr_init(*resampler) < 0) {
            av_channel_layout_uninit(&output_layout);
            return 0;
        }
        av_channel_layout_uninit(&output_layout);
        output->channels = channels;
        output->sample_rate = rate;
    }

    int64_t delay = swr_get_delay(*resampler, output->sample_rate);
    int samples = (int) av_rescale_rnd(delay + frame->nb_samples, output->sample_rate,
                                       frame->sample_rate, AV_ROUND_UP);
    int bytes = samples * output->channels * 2;
    if (!output_reserve(output, bytes)) return 0;
    uint8_t *target = output->data + output->size;
    int written = swr_convert(*resampler, &target, samples,
                              (const uint8_t **) frame->extended_data, frame->nb_samples);
    if (written < 0) return 0;
    output->size += written * output->channels * 2;
    return 1;
}

static int receive_frames(AVCodecContext *decoder, AVFrame *frame,
                          OutputBuffer *output, SwrContext **resampler) {
    for (;;) {
        int status = avcodec_receive_frame(decoder, frame);
        if (status == AVERROR(EAGAIN) || status == AVERROR_EOF) return 1;
        if (status < 0) return 0;
        int appended = append_frame(output, resampler, frame);
        av_frame_unref(frame);
        if (!appended) return 0;
    }
}

OutputBuffer *transcode(const uint8_t *data, int size) {
    if (!data || size <= 0 || size > MAX_INPUT_BYTES) return NULL;
    av_log_set_level(AV_LOG_QUIET);

    OutputBuffer *output = (OutputBuffer *) calloc(1, sizeof(OutputBuffer));
    AVFormatContext *format = NULL;
    AVCodecContext *decoder = NULL;
    AVIOContext *io = NULL;
    AVPacket *packet = NULL;
    AVFrame *frame = NULL;
    SwrContext *resampler = NULL;
    uint8_t *io_buffer = NULL;
    int ok = 0;

    if (!output || !output_reserve(output, WAV_HEADER_BYTES)) goto cleanup;
    output->size = WAV_HEADER_BYTES;

    InputBuffer input = { data, size, 0 };
    io_buffer = (uint8_t *) av_malloc(4096);
    format = avformat_alloc_context();
    if (!io_buffer || !format) goto cleanup;
    io = avio_alloc_context(io_buffer, 4096, 0, &input, input_read, NULL, input_seek);
    if (!io) goto cleanup;
    io_buffer = NULL;
    format->pb = io;
    format->flags |= AVFMT_FLAG_CUSTOM_IO;
    if (avformat_open_input(&format, NULL, NULL, NULL) < 0) goto cleanup;
    if (avformat_find_stream_info(format, NULL) < 0) goto cleanup;

    int stream_index = av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
    if (stream_index < 0) goto cleanup;
    AVCodecParameters *parameters = format->streams[stream_index]->codecpar;
    const AVCodec *codec = avcodec_find_decoder(parameters->codec_id);
    if (!codec) goto cleanup;
    decoder = avcodec_alloc_context3(codec);
    if (!decoder || avcodec_parameters_to_context(decoder, parameters) < 0 ||
        avcodec_open2(decoder, codec, NULL) < 0) goto cleanup;

    packet = av_packet_alloc();
    frame = av_frame_alloc();
    if (!packet || !frame) goto cleanup;
    while (av_read_frame(format, packet) >= 0) {
        if (packet->stream_index == stream_index) {
            if (avcodec_send_packet(decoder, packet) < 0 ||
                !receive_frames(decoder, frame, output, &resampler)) {
                av_packet_unref(packet);
                goto cleanup;
            }
        }
        av_packet_unref(packet);
    }
    if (avcodec_send_packet(decoder, NULL) < 0 ||
        !receive_frames(decoder, frame, output, &resampler)) goto cleanup;
    if (output->size <= WAV_HEADER_BYTES || !output->channels || !output->sample_rate) goto cleanup;
    output_write_header(output);
    ok = 1;

cleanup:
    swr_free(&resampler);
    av_frame_free(&frame);
    av_packet_free(&packet);
    avcodec_free_context(&decoder);
    avformat_close_input(&format);
    if (io) {
        av_freep(&io->buffer);
        avio_context_free(&io);
    }
    av_free(io_buffer);
    if (!ok && output) {
        free(output->data);
        free(output);
        output = NULL;
    }
    return output;
}

uint8_t *ob_get_data(OutputBuffer *output) {
    return output ? output->data : NULL;
}

int ob_get_size(OutputBuffer *output) {
    return output ? output->size : 0;
}

void ob_free(OutputBuffer *output) {
    if (!output) return;
    free(output->data);
    free(output);
}
