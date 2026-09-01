import assert from "node:assert/strict";
import test from "node:test";

import { INPUT_PROBE_KIND, consumeInputProbe } from "../web/input-probe.js";

test("input probe records the mobile key delivered by FreeJ2ME", () => {
  const first = consumeInputProbe("[j2me-web-input] -5", null);
  assert.deepEqual(first, {
    kind: INPUT_PROBE_KIND,
    keyCode: -5,
    schemaVersion: 1,
    sequence: 1
  });
  assert.deepEqual(consumeInputProbe("[j2me-web-input] 1", first), {
    kind: INPUT_PROBE_KIND,
    keyCode: 1,
    schemaVersion: 1,
    sequence: 2
  });
  assert.equal(consumeInputProbe("ordinary diagnostic", first), first);
});

test("input probe rejects malformed or out-of-range values", () => {
  assert.equal(consumeInputProbe("[j2me-web-input] 1 trailing", null), null);
  assert.equal(consumeInputProbe("[j2me-web-input] 999999", null), null);
});
