import assert from "node:assert/strict";
import test from "node:test";

import { VirtualKeyState, keyDescriptor } from "../web/virtual-keypad.js";

test("virtual keys preserve independent multi-touch pointers and release on teardown", () => {
  const events = [];
  const state = new VirtualKeyState({
    dispatch: (action, pressed) => events.push([action, pressed]),
    repeatDelayMs: 500,
    repeatIntervalMs: 80,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    setInterval: () => 2,
    clearInterval: () => undefined
  });

  state.press(10, "UP");
  state.press(11, "FIRE");
  state.press(12, "UP");
  state.release(10);
  assert.deepEqual(events, [["UP", true], ["FIRE", true]]);
  state.release(12);
  state.releaseAll();
  assert.deepEqual(events, [["UP", true], ["FIRE", true], ["UP", false], ["FIRE", false]]);
});

test("held virtual keys repeat after the configured delay without losing held state", () => {
  const events = [];
  let beginRepeating;
  let repeat;
  const state = new VirtualKeyState({
    dispatch: (action, pressed) => events.push([action, pressed]),
    repeatDelayMs: 400,
    repeatIntervalMs: 70,
    setTimeout: (callback, delay) => { assert.equal(delay, 400); beginRepeating = callback; return 1; },
    clearTimeout: () => undefined,
    setInterval: (callback, delay) => { assert.equal(delay, 70); repeat = callback; return 2; },
    clearInterval: () => undefined
  });

  state.press(1, "SOFT_LEFT");
  beginRepeating();
  repeat();
  state.release(1);
  assert.deepEqual(events, [
    ["SOFT_LEFT", true],
    ["SOFT_LEFT", false], ["SOFT_LEFT", true],
    ["SOFT_LEFT", false], ["SOFT_LEFT", true],
    ["SOFT_LEFT", false]
  ]);
});

test("phone profiles can swap soft keys while preserving DOM key identity", () => {
  assert.deepEqual(keyDescriptor("SOFT_LEFT", { input: { softKeySwap: false } }),
    { code: "KeyQ", key: "q", keyCode: 81 });
  assert.deepEqual(keyDescriptor("SOFT_LEFT", { input: { softKeySwap: true } }),
    { code: "KeyE", key: "e", keyCode: 69 });
  assert.deepEqual(keyDescriptor("STAR", null),
    { code: "NumpadMultiply", key: "*", keyCode: 106 });
});
