import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntime,
  describeRuntime,
  runtimeAdapter,
  sha256Hex,
  validateRuntimeConfig
} from "../web/runtime-api.js";

const digest = "12".repeat(32);
const config = {
  sessionId: "launch-1",
  contentDigest: digest,
  source: {
    kind: "J2ME_JAR_V1",
    name: "game.jar",
    sha256: digest,
    sizeBytes: 1234,
    url: "https://content.example/game.jar"
  },
  adapter: {
    adapterKind: "J2ME_MINIJVM_WEB",
    adapterId: "j2me-minijvm-web",
    runtimeBaseUrl: "https://runtime.example/j2me/",
    storage: "HOST",
    viewport: { width: 240, height: 320 }
  }
};

test("public descriptor matches Retrom's engine-neutral capability shape", () => {
  validateRuntimeConfig(config);
  const runtime = createRuntime(config, { restorePayload: null });

  assert.equal(runtime.getState(), "CREATED");
  assert.deepEqual(runtime.getCapabilities(), runtimeAdapter.capabilities);
  assert.deepEqual(describeRuntime(config), {
    crossOriginFrame: false,
    requiresThreads: true,
    runtimeBaseUrl: "https://runtime.example/j2me/"
  });
  assert.equal(runtimeAdapter.checkpointFormat, "j2me-rms-bundle-v1");
});

test("config validation rejects a digest or adapter identity mismatch", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...config, contentDigest: "34".repeat(32) }),
    /J2ME_RUNTIME_CONFIG_INVALID/u
  );
  assert.throws(
    () => validateRuntimeConfig({ ...config, adapter: { ...config.adapter, adapterId: "other" } }),
    /J2ME_RUNTIME_CONFIG_INVALID/u
  );
});

test("content hashing uses the same lower-case SHA-256 contract as the host", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
