import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COMPATIBILITY_PROFILE,
  encodeCoreProfile,
  resolveCompatibilityProfile
} from "../web/compatibility-profiles.js";

const xianDigest = "187550494eae6b8923edbf96524f4d0e84782467286fd2fd666c10f23935a07c";
const perfectXianDigest = "75aaf194cbd01715d4eaa99720e6876ff2355e494d3ed5f09c33d85cae81b100";

test("known games resolve by content digest instead of mutable file names", () => {
  const renamed = resolveCompatibilityProfile({ name: "renamed.jar", sha256: xianDigest });
  const unknown = resolveCompatibilityProfile({ name: "仙剑奇侠传.jar", sha256: "aa".repeat(32) });

  assert.equal(renamed.id, "xianjian-128x144");
  assert.deepEqual(renamed.viewport, { width: 128, height: 144 });
  assert.equal(unknown.id, DEFAULT_COMPATIBILITY_PROFILE.id);
  assert.deepEqual(unknown.viewport, { width: 240, height: 320 });
});

test("the MIDP 1.0 perfect edition uses its native Nokia viewport", () => {
  const profile = resolveCompatibilityProfile({ name: "renamed.jar", sha256: perfectXianDigest });

  assert.equal(profile.id, "xianjian-perfect-176x208");
  assert.equal(profile.phone, "Nokia");
  assert.deepEqual(profile.viewport, { width: 176, height: 208 });
  assert.equal(profile.launch.threadedStart, true);
});

test("a host can override bounded compatibility fields without mutating the catalog", () => {
  const first = resolveCompatibilityProfile({ sha256: xianDigest }, {
    frameRate: 30,
    phone: "Nokia",
    viewport: { width: 176, height: 208 },
    input: { softKeySwap: true, repeatDelayMs: 420, repeatIntervalMs: 70 },
    audio: { enabled: true, gain: 0.75, transcodeFallback: false },
    graphics3d: { backend: "SOFTWARE", halfResolution: true }
  });
  const second = resolveCompatibilityProfile({ sha256: xianDigest });

  assert.equal(first.frameRate, 30);
  assert.equal(first.input.softKeySwap, true);
  assert.equal(first.audio.gain, 0.75);
  assert.equal(first.graphics3d.backend, "SOFTWARE");
  assert.deepEqual(second.viewport, { width: 128, height: 144 });
  assert.throws(() => resolveCompatibilityProfile({ sha256: xianDigest }, {
    audio: { gain: 3 }
  }), /J2ME_COMPATIBILITY_PROFILE_INVALID/u);
});

test("the core profile is deterministic and contains emulator-facing settings", () => {
  const profile = resolveCompatibilityProfile({ sha256: xianDigest });
  assert.equal(encodeCoreProfile(profile), [
    "schema=1",
    "width=128",
    "height=144",
    "fps=60",
    "phone=Standard",
    "rotation=0",
    "sound=on",
    "m3g.backend=auto",
    "m3g.halfResolution=off",
    "midlet.launch=direct",
    ""
  ].join("\n"));
});
