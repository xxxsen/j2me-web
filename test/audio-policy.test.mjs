import assert from "node:assert/strict";
import test from "node:test";

import { installAudioActivation, resumeRuntimeAudio } from "../web/audio-policy.js";

test("runtime audio starts suspended Web Audio devices by default", () => {
  let resumeCalls = 0;
  const frameWindow = {
    miniaudio: {
      devices: [
        { webaudio: { state: "running", resume: () => { throw new Error("already running"); } } },
        { webaudio: { state: "suspended", resume: () => { resumeCalls += 1; return Promise.resolve(); } } }
      ]
    }
  };

  assert.equal(resumeRuntimeAudio(frameWindow), true);
  assert.equal(resumeCalls, 1);
  assert.equal(resumeRuntimeAudio({}), false);
});

test("keyboard and pointer activation retry audio without a separate sound control", () => {
  let resumeCalls = 0;
  const context = { state: "suspended", resume: () => { resumeCalls += 1; return Promise.resolve(); } };
  const source = createEventTarget();
  const display = createEventTarget();
  const activation = installAudioActivation({
    frameWindow: { miniaudio: { devices: [{ webaudio: context }] } },
    targets: [source, display]
  });

  source.dispatch("keydown");
  display.dispatch("pointerdown");
  assert.equal(resumeCalls, 2);
  activation.remove();
  source.dispatch("keydown");
  assert.equal(resumeCalls, 2);
});

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type) { listeners.get(type)?.(); }
  };
}
