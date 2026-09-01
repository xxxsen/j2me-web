import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_SCALING_MODES,
  computePresentationSize,
  scale2xPixels
} from "../web/video-scaling.js";

test("integer scaling keeps source pixels aligned and centered", () => {
  assert.deepEqual(
    computePresentationSize({ width: 128, height: 144 }, 1000, 600, "INTEGER_NEAREST"),
    { width: 512, height: 576 }
  );
  assert.deepEqual(
    computePresentationSize({ width: 240, height: 320 }, 200, 200, "INTEGER_NEAREST"),
    { width: 150, height: 200 }
  );
});

test("sharp-fit and Scale2x use all available space without changing aspect ratio", () => {
  for (const mode of ["SHARP_FIT", "SCALE2X"]) {
    assert.deepEqual(
      computePresentationSize({ width: 240, height: 320 }, 1000, 600, mode),
      { width: 450, height: 600 }
    );
  }
  assert.deepEqual(VIDEO_SCALING_MODES, ["INTEGER_NEAREST", "SHARP_FIT", "SCALE2X"]);
});

test("Scale2x preserves flat pixels and rounds an isolated corner", () => {
  const source = Uint32Array.of(
    0, 1, 0,
    1, 9, 0,
    0, 0, 0
  );
  const scaled = scale2xPixels(source, 3, 3);

  assert.equal(scaled.length, 36);
  assert.deepEqual(Array.from(scaled.slice(14, 16)), [1, 9]);
  assert.deepEqual(Array.from(scaled.slice(20, 22)), [9, 0]);
});
