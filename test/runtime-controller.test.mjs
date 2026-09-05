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
  virtualKeyInput: true,
  virtualKeyActions: Object.freeze(["FIRE"]),
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
    setInput: (action, pressed) => inputEvents.push([action, pressed]),
    setVolume: null,
    ...overrides
  };
}

const inputEvents = [];

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
  runtime.setInput("FIRE", true);
  runtime.setInput("FIRE", false);
  assert.deepEqual(inputEvents.splice(0), [["FIRE", true], ["FIRE", false]]);
  assert.throws(() => runtime.setInput("INVALID", true), /J2ME_INPUT_INVALID/u);
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

test("exit cancels loading and waits for partial adapter teardown", async () => {
  let finish;
  let signal;
  let exited = false;
  const runtime = new GameRuntimeController((_target, _progress, _exit, _failure, loadingSignal) => {
    signal = loadingSignal;
    return new Promise((resolve) => { finish = () => resolve(adapterFixture({ exit: async () => { exited = true; } })); });
  }, capabilities);
  const mounting = runtime.mount({});
  const rejected = assert.rejects(mounting, { name: "AbortError" });
  let exitFinished = false;
  const exiting = runtime.exit().then(() => { exitFinished = true; });
  await Promise.resolve();
  const cancelled = signal?.aborted;
  const premature = exitFinished;
  finish();
  await Promise.all([exiting, rejected]);
  assert.equal(cancelled, true);
  assert.equal(premature, false);
  assert.equal(exited, true);
  assert.equal(runtime.getState(), "EXITED");
});

test("host listener exceptions cannot strand exit or hide later listeners", async () => {
  let exits = 0;
  const events = [];
  const runtime = new GameRuntimeController(async () => adapterFixture({ exit: async () => { exits++; } }), capabilities);
  await runtime.mount({});
  runtime.subscribe(() => { throw new Error("broken host UI"); });
  runtime.subscribe((event) => events.push(event));
  try {
    await runtime.exit();
    assert.equal(exits, 1);
    assert.equal(runtime.getState(), "EXITED");
    assert.ok(events.some((event) => event.state === "EXITED"));
  } finally { runtime.stopAvailabilityPolling(); }
});

test("runtime failures after READY fail closed and clean up once", async () => {
  let fail;
  let exits = 0;
  const events = [];
  const runtime = new GameRuntimeController(async (_target, _progress, _exit, reportFailure) => {
    fail = reportFailure;
    return adapterFixture({ exit: async () => { exits++; } });
  }, capabilities);
  runtime.subscribe((event) => events.push(event));
  await runtime.mount({});
  try {
    assert.equal(typeof fail, "function");
    await fail(new Error("J2ME_RUNTIME_FAILED"));
    await fail(new Error("J2ME_RUNTIME_FAILED"));
    assert.equal(runtime.getState(), "FAILED");
    assert.equal(runtime.getCheckpointAvailability().available, false);
    assert.equal(exits, 1);
    assert.equal(events.filter((event) => event.type === "FATAL_ERROR").length, 1);
  } finally { await runtime.exit(); }
});

test("pause suppresses host presses and audio activation until resume", async () => {
  const inputs = [];
  let activations = 0;
  const runtime = new GameRuntimeController(async () => adapterFixture({
    setInput: (...args) => inputs.push(args),
    unlockAudio: () => { activations++; return true; }
  }), capabilities);
  await runtime.mount({});
  try {
    await runtime.pause();
    runtime.setInput("FIRE", true);
    runtime.setInput("FIRE", false);
    assert.equal(runtime.unlockAudio(), false);
    assert.deepEqual(inputs, []);
    assert.equal(activations, 0);
    await runtime.resume();
    runtime.setInput("FIRE", true);
    assert.deepEqual(inputs, [["FIRE", true]]);
  } finally { await runtime.exit(); }
});

test("an exit requested by a RUNNING listener does not emit READY or leak polling", async () => {
  const events = [];
  const runtime = new GameRuntimeController(async () => adapterFixture(), capabilities);
  runtime.subscribe((event) => {
    events.push(event);
    if (event.state === "RUNNING") void runtime.exit();
  });
  try { await runtime.mount({}); } catch (error) { assert.equal(error.name, "AbortError"); }
  await runtime.exit();
  const timer = runtime.availabilityTimer;
  runtime.stopAvailabilityPolling();
  assert.equal(timer, null);
  assert.equal(events.some((event) => event.type === "READY"), false);
});

test("a failure racing with exit does not invalidate the exit transition", async () => {
  let reportFailure;
  let exits = 0;
  const runtime = new GameRuntimeController(async (_target, _progress, _exit, fail) => {
    reportFailure = fail;
    return adapterFixture({ exit: async () => { exits++; } });
  }, capabilities);
  await runtime.mount({});
  await Promise.all([reportFailure(new Error("J2ME_RUNTIME_FAILED")), runtime.exit()]);
  assert.equal(runtime.getState(), "EXITED");
  assert.equal(exits, 1);
});
