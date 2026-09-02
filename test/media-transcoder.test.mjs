import assert from "node:assert/strict";
import test from "node:test";

import { createAudioTranscoder } from "../web/media-transcoder.js";

test("audio transcoding is lazy, transferable and reusable", async () => {
  const workers = [];
  let compileCalls = 0;
  class FakeWorker {
    constructor(url) { this.url = String(url); this.listeners = []; this.messages = []; workers.push(this); }
    addEventListener(type, listener) { if (type === "message") this.listeners.push(listener); }
    postMessage(message, transfer) {
      this.messages.push({ message, transfer });
      queueMicrotask(() => {
        const wave = new Uint8Array(44);
        wave.set([82, 73, 70, 70]);
        const value = message.cmd === "transcode" ? wave.buffer : true;
        for (const listener of this.listeners) listener({ data: { replyFor: message.id, value } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const environment = {
    Worker: FakeWorker,
    fetch: async () => ({ ok: true }),
    WebAssembly: {
      compileStreaming: async () => { compileCalls += 1; return { module: true }; }
    }
  };
  const transcoder = createAudioTranscoder("https://runtime.example/v1/", environment);
  const source = Uint8Array.of(1, 2, 3).buffer;

  assert.deepEqual(new Uint8Array(await transcoder.transcode(source)).subarray(0, 4), Uint8Array.of(82, 73, 70, 70));
  assert.deepEqual(new Uint8Array(await transcoder.transcode(Uint8Array.of(4).buffer)).subarray(0, 4), Uint8Array.of(82, 73, 70, 70));
  assert.equal(workers.length, 1);
  assert.equal(compileCalls, 1);
  assert.equal(workers[0].url, "https://runtime.example/v1/audio-transcoder.worker.js");
  assert.equal(workers[0].messages[1].transfer[0], source);
  assert.deepEqual(transcoder.getStats(), { failures: 0, requests: 2, successes: 2 });
  transcoder.close();
  assert.equal(workers[0].terminated, true);
  await assert.rejects(transcoder.transcode(Uint8Array.of(5).buffer), /J2ME_MEDIA_TRANSCODER_CLOSED/u);
});

test("invalid transcoder results fail closed", async () => {
  class EmptyWorker {
    addEventListener(_type, listener) { this.listener = listener; }
    postMessage(message) {
      queueMicrotask(() => this.listener({ data: { replyFor: message.id, value: message.cmd === "init" } }));
    }
    terminate() { }
  }
  const transcoder = createAudioTranscoder("https://runtime.example/v1/", {
    Worker: EmptyWorker,
    fetch: async () => ({ ok: true }),
    WebAssembly: { compileStreaming: async () => ({}) }
  });
  await assert.rejects(transcoder.transcode(Uint8Array.of(1).buffer), /J2ME_MEDIA_TRANSCODE_FAILED/u);
  assert.deepEqual(transcoder.getStats(), { failures: 1, requests: 1, successes: 0 });
});
