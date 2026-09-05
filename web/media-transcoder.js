const requestTimeoutMs = 30000;
const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
function bufferSize(value) {
  try { return byteLength.call(value); } catch { return null; }
}

export function createAudioTranscoder(runtimeBaseUrl, environment = globalThis) {
  const base = new URL(runtimeBaseUrl);
  const stats = { failures: 0, requests: 0, successes: 0 };
  let session = null;
  let closed = false;
  let nextId = 0;

  function fail(active, error) {
    if (active.error) return;
    active.error = error;
    active.abort.abort();
    active.worker?.terminate();
    for (const request of active.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    active.pending.clear();
    active.rejectFailure(error);
    if (session === active) session = null;
  }

  function send(active, message, transfer = []) {
    if (active.error) return Promise.reject(active.error);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(active, new Error("J2ME_MEDIA_TRANSCODER_TIMEOUT")), requestTimeoutMs);
      active.pending.set(id, { resolve, reject, timer });
      try { active.worker.postMessage({ ...message, id }, transfer); }
      catch (error) { fail(active, error); }
    });
  }

  function ensureReady() {
    if (closed) return Promise.reject(new Error("J2ME_MEDIA_TRANSCODER_CLOSED"));
    if (!session) {
      const active = { abort: new AbortController(), error: null, pending: new Map(), worker: null };
      const failed = new Promise((_resolve, reject) => { active.rejectFailure = reject; });
      session = active;
      active.ready = Promise.race([failed, (async () => {
        active.worker = new environment.Worker(new URL("audio-transcoder.worker.js", base), { type: "classic" });
        const workerFailed = (event) => {
          event.preventDefault?.();
          fail(active, new Error("J2ME_MEDIA_TRANSCODER_UNAVAILABLE"));
        };
        active.worker.addEventListener("error", workerFailed);
        active.worker.addEventListener("messageerror", workerFailed);
        active.worker.addEventListener("message", ({ data }) => {
          const request = active.pending.get(data?.replyFor);
          if (!request) return;
          active.pending.delete(data.replyFor);
          clearTimeout(request.timer);
          if (data.error !== undefined) request.reject(new Error(String(data.error)));
          else request.resolve(data.value);
        });
        const response = await environment.fetch(new URL("audio-transcoder.wasm", base), { signal: active.abort.signal });
        if (!response?.ok) throw new Error("J2ME_MEDIA_TRANSCODER_UNAVAILABLE");
        const module = await environment.WebAssembly.compileStreaming(Promise.resolve(response));
        await send(active, { cmd: "init", module });
        return active;
      })()]).catch((error) => { fail(active, error); throw error; });
      // Bound asset loading as well as worker messages. clear on every completion.
      const timer = setTimeout(() => fail(active, new Error("J2ME_MEDIA_TRANSCODER_TIMEOUT")), requestTimeoutMs);
      active.ready.then(() => clearTimeout(timer), () => clearTimeout(timer));
    }
    return session.ready;
  }

  return {
    async transcode(value) {
      if (closed) throw new Error("J2ME_MEDIA_TRANSCODER_CLOSED");
      const bytes = bufferSize(value) !== null
        ? value
        : ArrayBuffer.isView(value)
          ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          : null;
      if (!bytes?.byteLength) throw new Error("J2ME_MEDIA_TRANSCODE_FAILED");
      stats.requests++;
      try {
        const active = await ensureReady();
        const output = await send(active, { cmd: "transcode", data: bytes }, [bytes]);
        if ((bufferSize(output) ?? 0) < 44) throw new Error("J2ME_MEDIA_TRANSCODE_FAILED");
        stats.successes++;
        return output;
      } catch (error) {
        stats.failures++;
        throw error?.message === "J2ME_MEDIA_TRANSCODER_CLOSED"
          ? error : new Error("J2ME_MEDIA_TRANSCODE_FAILED", { cause: error });
      }
    },
    getStats: () => ({ ...stats }),
    close() {
      if (closed) return;
      closed = true;
      if (session) fail(session, new Error("J2ME_MEDIA_TRANSCODER_CLOSED"));
    }
  };
}
