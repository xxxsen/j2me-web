import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKPOINT_FORMAT,
  MAX_CHECKPOINT_BYTES,
  decodeCheckpoint,
  encodeCheckpoint,
  measureCheckpoint
} from "../web/checkpoint-codec.js";

const digest = "ab".repeat(32);

test("metadata sizing matches the encoded bundle and enforces its limits", () => {
  const files = [{ path: "suite/存档", bytes: Uint8Array.of(1, 2, 3) }];
  assert.equal(measureCheckpoint(files.map((file) => ({ path: file.path, sizeBytes: file.bytes.length }))),
    encodeCheckpoint(digest, files).length);
  assert.throws(() => measureCheckpoint([{ path: "large", sizeBytes: MAX_CHECKPOINT_BYTES }]), /J2ME_CHECKPOINT_TOO_LARGE/u);
  assert.throws(() => measureCheckpoint(Array.from({ length: 4097 }, (_, i) => ({ path: String(i), sizeBytes: 0 }))),
    /J2ME_CHECKPOINT_INVALID/u);
  assert.throws(() => measureCheckpoint([{ path: "../escape", sizeBytes: 0 }]), /J2ME_CHECKPOINT_INVALID/u);
});

test("RMS checkpoints are deterministic, bounded and round-trip exact bytes", () => {
  const files = [
    { path: "suite/store.2", bytes: Uint8Array.of(4, 5) },
    { path: "suite/store.1", bytes: Uint8Array.of(1, 2, 3) }
  ];
  const first = encodeCheckpoint(digest, files);
  const second = encodeCheckpoint(digest, files.slice().reverse());
  const decoded = decodeCheckpoint(first, digest);

  assert.equal(CHECKPOINT_FORMAT, "j2me-rms-bundle-v1");
  assert.ok(first.byteLength < MAX_CHECKPOINT_BYTES);
  assert.deepEqual(first, second);
  assert.equal(decoded.contentDigest, digest);
  assert.deepEqual(decoded.files, [
    { path: "suite/store.1", bytes: Uint8Array.of(1, 2, 3) },
    { path: "suite/store.2", bytes: Uint8Array.of(4, 5) }
  ]);
});

test("checkpoint decode rejects another game and unsafe paths", () => {
  const checkpoint = encodeCheckpoint(digest, [{ path: "suite/save.rms", bytes: Uint8Array.of(1) }]);
  assert.throws(() => decodeCheckpoint(checkpoint, "cd".repeat(32)), /J2ME_CHECKPOINT_GAME_MISMATCH/u);
  assert.throws(
    () => encodeCheckpoint(digest, [{ path: "../escape", bytes: Uint8Array.of(1) }]),
    /J2ME_CHECKPOINT_INVALID/u
  );
});

test("checkpoint encoding fails closed above the public 2 MiB limit", () => {
  assert.throws(
    () => encodeCheckpoint(digest, [{ path: "suite/large.rms", bytes: new Uint8Array(MAX_CHECKPOINT_BYTES) }]),
    /J2ME_CHECKPOINT_TOO_LARGE/u
  );
});
