import assert from "node:assert/strict";
import test from "node:test";

import { KEY_STATE_PROBE_KIND, consumeKeyStateProbe } from "../web/key-state-probe.js";

test("key-state probe records the GameCanvas state observed by the MIDlet", () => {
  const pressed = consumeKeyStateProbe(
    "[j2me-web-key-state] key=53 action=8 state=256 pressed=1",
    null
  );
  assert.deepEqual(pressed, {
    kind: KEY_STATE_PROBE_KIND,
    schemaVersion: 1,
    sequence: 1,
    keyCode: 53,
    gameAction: 8,
    state: 256,
    pressed: true
  });
  assert.equal(consumeKeyStateProbe(
    "[j2me-web-key-state] key=53 action=8 state=0 pressed=0",
    pressed
  ).pressed, false);
});

test("key-state probe ignores malformed diagnostics", () => {
  assert.equal(consumeKeyStateProbe(
    "[j2me-web-key-state] key=53 action=8 state=-1 pressed=1",
    null
  ), null);
});
