import assert from "node:assert/strict";
import test from "node:test";

import { GameRuntimeController } from "../web/runtime-controller.js";

const capabilities = Object.freeze({
  checkpoint: true,
  contentSources: Object.freeze(["J2ME_JAR_V1"]),
  frameCounter: true,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  validationProbes: Object.freeze(["J2ME_INPUT_V1"]),
  videoScalingModes: Object.freeze(["INTEGER_NEAREST", "SHARP_FIT", "SCALE2X"]),
  volume: false
});

function adapterFixture(overrides = {}) {
  return {
    checkpoint: async () => ({ bytes: Uint8Array.of(1, 2, 3), format: "j2me-rms-bundle-v1" }),
    exit: async () => undefined,
    getCanvas: () => ({ tagName: "CANVAS" }),
    getCheckpointAvailability: () => ({ available: true, blocker: null }),
    getFrameCount: () => 12,
    getValidationProbe: (kind) => kind === "J2ME_INPUT_V1"
      ? { kind, keyCode: -5, schemaVersion: 1, sequence: 1 }
      : null,
    pause: async () => undefined,
    resume: async () => undefined,
    screenshot: async () => new Blob([Uint8Array.of(1)], { type: "image/png" }),
    getScalingMode: () => "SHARP_FIT",
    setScalingMode: () => undefined,
    setVolume: null,
    ...overrides
  };
}

test("controller exposes the Retrom lifecycle and serializes host operations", async () => {
  const adapter = adapterFixture();
  const events = [];
  const runtime = new GameRuntimeController(async () => adapter, capabilities);
  runtime.subscribe((event) => events.push(event));

  await runtime.mount({});
  assert.equal(runtime.getState(), "RUNNING");
  assert.equal(runtime.getFrameCount(), 12);
  assert.deepEqual(runtime.getValidationProbe("J2ME_INPUT_V1"), {
    kind: "J2ME_INPUT_V1", keyCode: -5, schemaVersion: 1, sequence: 1
  });
  assert.equal(runtime.getScalingMode(), "SHARP_FIT");
  runtime.setScalingMode("INTEGER_NEAREST");
  assert.equal(runtime.getScalingMode(), "SHARP_FIT");
  await runtime.pause();
  assert.equal(runtime.getState(), "PAUSED");
  assert.deepEqual(await runtime.checkpoint(), {
    bytes: Uint8Array.of(1, 2, 3),
    format: "j2me-rms-bundle-v1"
  });
  await runtime.resume();
  assert.equal(runtime.getState(), "RUNNING");
  assert.equal((await runtime.screenshot()).type, "image/png");
  assert.ok(events.some((event) => event.type === "READY"));
  await runtime.exit();
  assert.equal(runtime.getState(), "EXITED");
});

test("a core-owned exit is emitted once and tears down checkpoint access", async () => {
  let requestExit;
  let exitCalls = 0;
  const events = [];
  const adapter = adapterFixture({ exit: async () => { exitCalls += 1; } });
  const runtime = new GameRuntimeController(async (_target, _progress, reportExit) => {
    requestExit = reportExit;
    return adapter;
  }, capabilities);
  runtime.subscribe((event) => events.push(event));
  await runtime.mount({});

  requestExit();
  requestExit();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtime.getState(), "EXITED");
  assert.equal(exitCalls, 1);
  assert.equal(events.filter((event) => event.type === "EXIT_REQUESTED").length, 1);
  await assert.rejects(runtime.checkpoint(), { name: "AbortError" });
});
