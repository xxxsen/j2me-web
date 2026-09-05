export const CHECKPOINT_FORMAT = "j2me-rms-bundle-v1";
export const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

const magic = Uint8Array.of(0x4a, 0x32, 0x4d, 0x45, 0x52, 0x4d, 0x53, 0x01);
const digestBytes = 32;
const fixedHeaderBytes = magic.byteLength + digestBytes + 4;
const maximumFiles = 4096;
const maximumPathBytes = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function measureCheckpoint(files) {
  if (!Array.isArray(files) || files.length > maximumFiles) throw new Error("J2ME_CHECKPOINT_INVALID");
  let total = fixedHeaderBytes;
  const paths = new Set();
  for (const file of files) {
    const path = String(file?.path ?? "");
    assertRelativePath(path);
    const length = encoder.encode(path).byteLength;
    if (paths.has(path) || length > maximumPathBytes || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error("J2ME_CHECKPOINT_INVALID");
    }
    paths.add(path);
    total += 6 + length + file.sizeBytes;
    if (total > MAX_CHECKPOINT_BYTES) throw new Error("J2ME_CHECKPOINT_TOO_LARGE");
  }
  return total;
}

export function encodeCheckpoint(contentDigest, files) {
  const digest = decodeDigest(contentDigest);
  const entries = normalizedEntries(files);
  let total = fixedHeaderBytes;
  for (const entry of entries) total += 2 + 4 + entry.pathBytes.byteLength + entry.bytes.byteLength;
  if (total > MAX_CHECKPOINT_BYTES) throw new Error("J2ME_CHECKPOINT_TOO_LARGE");

  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;
  output.set(magic, offset);
  offset += magic.byteLength;
  output.set(digest, offset);
  offset += digest.byteLength;
  view.setUint32(offset, entries.length, true);
  offset += 4;

  for (const entry of entries) {
    view.setUint16(offset, entry.pathBytes.byteLength, true);
    offset += 2;
    view.setUint32(offset, entry.bytes.byteLength, true);
    offset += 4;
    output.set(entry.pathBytes, offset);
    offset += entry.pathBytes.byteLength;
    output.set(entry.bytes, offset);
    offset += entry.bytes.byteLength;
  }
  return output;
}

export function decodeCheckpoint(payload, expectedContentDigest = null) {
  const input = copyBytes(payload);
  if (input.byteLength < fixedHeaderBytes || input.byteLength > MAX_CHECKPOINT_BYTES) {
    throw new Error("J2ME_CHECKPOINT_INVALID");
  }
  for (let index = 0; index < magic.byteLength; index += 1) {
    if (input[index] !== magic[index]) throw new Error("J2ME_CHECKPOINT_INVALID");
  }

  let offset = magic.byteLength;
  const contentDigest = encodeDigest(input.subarray(offset, offset + digestBytes));
  offset += digestBytes;
  if (expectedContentDigest !== null && contentDigest !== normalizeDigest(expectedContentDigest)) {
    throw new Error("J2ME_CHECKPOINT_GAME_MISMATCH");
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const count = view.getUint32(offset, true);
  offset += 4;
  if (count > maximumFiles) throw new Error("J2ME_CHECKPOINT_INVALID");

  const paths = new Set();
  const files = [];
  try {
    for (let index = 0; index < count; index += 1) {
      if (offset + 6 > input.byteLength) throw new Error("J2ME_CHECKPOINT_INVALID");
      const pathLength = view.getUint16(offset, true);
      offset += 2;
      const dataLength = view.getUint32(offset, true);
      offset += 4;
      if (!pathLength || pathLength > maximumPathBytes || offset + pathLength + dataLength > input.byteLength) {
        throw new Error("J2ME_CHECKPOINT_INVALID");
      }
      const path = decoder.decode(input.subarray(offset, offset + pathLength));
      offset += pathLength;
      assertRelativePath(path);
      if (paths.has(path)) throw new Error("J2ME_CHECKPOINT_INVALID");
      paths.add(path);
      const bytes = input.slice(offset, offset + dataLength);
      offset += dataLength;
      files.push({ path, bytes });
    }
  } catch (error) {
    if (error instanceof Error && /^J2ME_CHECKPOINT_/u.test(error.message)) throw error;
    throw new Error("J2ME_CHECKPOINT_INVALID");
  }
  if (offset !== input.byteLength) throw new Error("J2ME_CHECKPOINT_INVALID");
  return { contentDigest, files };
}

function normalizedEntries(files) {
  if (!Array.isArray(files) || files.length > maximumFiles) throw new Error("J2ME_CHECKPOINT_INVALID");
  const paths = new Set();
  return files.map((file) => {
    const path = String(file?.path ?? "");
    assertRelativePath(path);
    if (paths.has(path)) throw new Error("J2ME_CHECKPOINT_INVALID");
    paths.add(path);
    const pathBytes = encoder.encode(path);
    if (!pathBytes.byteLength || pathBytes.byteLength > maximumPathBytes) {
      throw new Error("J2ME_CHECKPOINT_INVALID");
    }
    return { path, pathBytes, bytes: copyBytes(file?.bytes) };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function assertRelativePath(path) {
  const parts = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("J2ME_CHECKPOINT_INVALID");
  }
}

function copyBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error("J2ME_CHECKPOINT_INVALID");
}

function decodeDigest(value) {
  const normalized = normalizeDigest(value);
  const bytes = new Uint8Array(digestBytes);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function encodeDigest(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeDigest(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw new Error("J2ME_CHECKPOINT_INVALID");
  }
  return value.toLowerCase();
}
