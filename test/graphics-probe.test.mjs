import assert from "node:assert/strict";
import test from "node:test";

import { GRAPHICS_PROBE_KIND, consumeGraphicsProbe } from "../web/graphics-probe.js";

test("graphics probe records a real WebGL2 frame", () => {
  const probe = consumeGraphicsProbe(
    "[J2ME_3D_V1] api=M3G backend=WEBGL2 event=frame items=7",
    null
  );
  assert.deepEqual(probe, {
    kind: GRAPHICS_PROBE_KIND,
    schemaVersion: 1,
    sequence: 1,
    api: "M3G",
    backend: "WEBGL2",
    event: "frame",
    items: 7,
    reason: null
  });
});

test("graphics probe exposes explicit software fallback and ignores malformed messages", () => {
  const previous = consumeGraphicsProbe(
    "[J2ME_3D_V1] api=MASCOT backend=SOFTWARE event=fallback items=2 reason=unsupportedPrimitive",
    null
  );
  assert.equal(previous.api, "MASCOT");
  assert.equal(previous.backend, "SOFTWARE");
  assert.equal(previous.reason, "unsupportedPrimitive");
  assert.equal(consumeGraphicsProbe("[J2ME_3D_V1] api=bogus", previous), previous);
});
