export function createAudioTranscoder(runtimeBaseUrl, environment = globalThis) {
  const base = new URL(runtimeBaseUrl);
  const stats = { failures: 0, requests: 0, successes: 0 };
  let worker = null;
  let ready = null;
  let closed = false;
  let nextId = 0;
  const pending = new Map();

  const onMessage = (event) => {
    const reply = event.data;
    const request = pending.get(reply?.replyFor);
    if (!request) return;
    pending.delete(reply.replyFor);
    if (reply.error !== undefined) request.reject(new Error(String(reply.error)));
    else request.resolve(reply.value);
  };

  const send = (message, transfer = []) => {
    if (closed) return Promise.reject(new Error("J2ME_MEDIA_TRANSCODER_CLOSED"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve });
      worker.postMessage({ ...message, id }, transfer);
    });
  };

  const ensureReady = async () => {
    if (closed) throw new Error("J2ME_MEDIA_TRANSCODER_CLOSED");
    if (!ready) {
      ready = (async () => {
        worker = new environment.Worker(new URL("audio-transcoder.worker.js", base), { type: "classic" });
        worker.addEventListener("message", onMessage);
        const response = await environment.fetch(new URL("audio-transcoder.wasm", base));
        if (!response?.ok) throw new Error("J2ME_MEDIA_TRANSCODER_UNAVAILABLE");
        const module = await environment.WebAssembly.compileStreaming(Promise.resolve(response));
        await send({ cmd: "init", module });
      })();
    }
    try { await ready; }
    catch (error) {
      ready = null;
      worker?.terminate();
      worker = null;
      throw error;
    }
  };

  return {
    async transcode(value) {
      if (closed) throw new Error("J2ME_MEDIA_TRANSCODER_CLOSED");
      const bytes = value instanceof ArrayBuffer
        ? value
        : ArrayBuffer.isView(value)
          ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          : null;
      if (!bytes?.byteLength) throw new Error("J2ME_MEDIA_TRANSCODE_FAILED");
      stats.requests += 1;
      try {
        await ensureReady();
        const output = await send({ cmd: "transcode", data: bytes }, [bytes]);
        if (!(output instanceof ArrayBuffer) || output.byteLength < 44) {
          throw new Error("J2ME_MEDIA_TRANSCODE_FAILED");
        }
        stats.successes += 1;
        return output;
      } catch (error) {
        stats.failures += 1;
        throw error?.message === "J2ME_MEDIA_TRANSCODER_CLOSED"
          ? error
          : new Error("J2ME_MEDIA_TRANSCODE_FAILED", { cause: error });
      }
    },
    getStats: () => ({ ...stats }),
    close() {
      if (closed) return;
      closed = true;
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new Error("J2ME_MEDIA_TRANSCODER_CLOSED"));
      pending.clear();
    }
  };
}
