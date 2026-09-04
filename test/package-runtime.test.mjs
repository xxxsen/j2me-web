import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

import {
  bundleRuntimeApi,
  composeAudioWorker,
  createDeterministicZip
} from "../scripts/release-package-lib.mjs";

test("the public runtime API is distributed as one browser ESM bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "j2me-runtime-bundle-"));
  const output = join(directory, "j2me-runtime.js");
  try {
    await bundleRuntimeApi(new URL("../web/runtime-api.js", import.meta.url), output);
    const source = await readFile(output, "utf8");
    assert.doesNotMatch(source, /from["']\.\/(?:checkpoint-codec|runtime-controller)\.js/u);

    const runtime = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
    assert.equal(typeof runtime.createRuntime, "function");
    assert.equal(typeof runtime.mountRuntime, "function");
    assert.equal(typeof runtime.validateRuntimeConfig, "function");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("the audio worker embeds Emscripten glue instead of loading another release asset", () => {
  const result = composeAudioWorker(
    "var createFfmpegAudioTranscoder = () => Promise.resolve({});\n",
    'importScripts("audio-transcoder.glue.js");\nself.onmessage = () => {};\n'
  );
  assert.match(result, /^var createFfmpegAudioTranscoder/u);
  assert.match(result, /self\.onmessage/u);
  assert.doesNotMatch(result, /importScripts/u);
});

test("the runtime ZIP is deterministic and contains one versioned root directory", () => {
  const entries = [
    { path: "runtime.wasm", bytes: new Uint8Array([0, 97, 115, 109]) },
    { path: "j2me-runtime.js", bytes: new TextEncoder().encode("export {};\n") }
  ];
  const first = createDeterministicZip("j2me-web-v1.2.3-runtime", entries);
  const second = createDeterministicZip("j2me-web-v1.2.3-runtime", [...entries].reverse());
  assert.deepEqual(first, second);

  const contents = unzipSync(first);
  assert.deepEqual(Object.keys(contents).sort(), [
    "j2me-web-v1.2.3-runtime/j2me-runtime.js",
    "j2me-web-v1.2.3-runtime/runtime.wasm"
  ]);
  assert.equal(strFromU8(contents["j2me-web-v1.2.3-runtime/j2me-runtime.js"]), "export {};\n");
});
