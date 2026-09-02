import assert from "node:assert/strict";
import test from "node:test";

import { GC_PROBE_KIND, consumeGcProbe } from "../web/gc-probe.js";

test("GC probe records completed browser collection cycles", () => {
  const first = consumeGcProbe(
    "[j2me-web-gc] cycle=4 before=12000000 after=7000000 reclaimed=5000000 wait_ms=3 stw_ms=12",
    null
  );
  assert.deepEqual(first, {
    kind: GC_PROBE_KIND,
    schemaVersion: 1,
    sequence: 1,
    cycle: 4,
    beforeBytes: 12000000,
    afterBytes: 7000000,
    reclaimedBytes: 5000000,
    waitMs: 3,
    stopWorldMs: 12
  });
  assert.equal(consumeGcProbe("ordinary diagnostic", first), first);
});

test("GC probe rejects malformed and inconsistent collection metrics", () => {
  assert.equal(consumeGcProbe("[j2me-web-gc] cycle=0 before=4 after=2 reclaimed=2 wait_ms=0 stw_ms=1", null), null);
  assert.equal(consumeGcProbe("[j2me-web-gc] cycle=1 before=4 after=5 reclaimed=0 wait_ms=0 stw_ms=1", null), null);
  assert.equal(consumeGcProbe("[j2me-web-gc] cycle=1 before=4 after=2 reclaimed=5 wait_ms=0 stw_ms=1", null), null);
  assert.equal(consumeGcProbe("[j2me-web-gc] cycle=1 before=4 after=2 reclaimed=2", null), null);
});
