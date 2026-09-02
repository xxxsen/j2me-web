importScripts("audio-transcoder.glue.js");

let glue = null;

self.onmessage = async (event) => {
  const { cmd, id } = event.data ?? {};
  if (!cmd || !Number.isSafeInteger(id)) return;
  try {
    if (cmd === "init") {
      glue = await createGlue(event.data.module);
      self.postMessage({ replyFor: id, value: true });
      return;
    }
    if (cmd !== "transcode" || !glue || !(event.data.data instanceof ArrayBuffer)) {
      throw new Error("J2ME_MEDIA_TRANSCODER_PROTOCOL");
    }
    const output = glue.transcode(event.data.data);
    if (!output) throw new Error("J2ME_MEDIA_TRANSCODE_FAILED");
    self.postMessage({ replyFor: id, value: output }, [output]);
  } catch (error) {
    self.postMessage({ replyFor: id, error: error instanceof Error ? error.message : String(error) });
  }
};

async function createGlue(module) {
  const instance = await createFfmpegAudioTranscoder({
    instantiateWasm(imports, receiveInstance) {
      WebAssembly.instantiate(module, imports).then((result) => receiveInstance(result, module));
      return {};
    }
  });
  const required = ["_malloc", "_free", "_transcode", "_ob_get_data", "_ob_get_size", "_ob_free"];
  if (required.some((name) => typeof instance[name] !== "function")) {
    throw new Error("J2ME_MEDIA_TRANSCODER_INVALID");
  }
  return {
    transcode(input) {
      const pointer = instance._malloc(input.byteLength);
      if (!pointer) return null;
      try {
        instance.HEAPU8.set(new Uint8Array(input), pointer);
        const result = instance._transcode(pointer, input.byteLength);
        if (!result) return null;
        try {
          const data = instance._ob_get_data(result);
          const size = instance._ob_get_size(result);
          if (!data || size < 44 || data + size > instance.HEAPU8.length) return null;
          return instance.HEAPU8.slice(data, data + size).buffer;
        } finally {
          instance._ob_free(result);
        }
      } finally {
        instance._free(pointer);
      }
    }
  };
}
