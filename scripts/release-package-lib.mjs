import { build } from "esbuild";
import { zipSync } from "fflate";
import { fileURLToPath } from "node:url";

const zipEpoch = new Date(1980, 0, 1, 0, 0, 0, 0);

export async function bundleRuntimeApi(entryPoint, outfile) {
  await build({
    bundle: true,
    charset: "utf8",
    entryPoints: [entryPoint instanceof URL ? fileURLToPath(entryPoint) : entryPoint],
    format: "esm",
    legalComments: "none",
    minify: true,
    outfile,
    platform: "browser",
    sourcemap: false,
    target: "es2022"
  });
}

export function composeAudioWorker(glueSource, workerSource) {
  if (typeof glueSource !== "string" || !glueSource.trim() || typeof workerSource !== "string") {
    throw new Error("Invalid audio worker source");
  }
  const importPattern = /^\s*importScripts\(["']audio-transcoder\.glue\.js["']\);\s*/u;
  if (!importPattern.test(workerSource)) throw new Error("Audio worker glue import not found");
  return `${glueSource.trimEnd()}\n\n${workerSource.replace(importPattern, "").trimStart()}`;
}

export function createDeterministicZip(rootDirectory, entries) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(rootDirectory) || !Array.isArray(entries) || !entries.length) {
    throw new Error("Invalid runtime archive");
  }

  const seen = new Set();
  const normalized = entries.map((entry) => {
    const path = entry?.path;
    const bytes = entry?.bytes instanceof Uint8Array
      ? entry.bytes
      : ArrayBuffer.isView(entry?.bytes)
        ? new Uint8Array(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)
        : entry?.bytes instanceof ArrayBuffer
          ? new Uint8Array(entry.bytes)
          : null;
    if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..") || !bytes || seen.has(path)) {
      throw new Error("Invalid runtime archive entry");
    }
    seen.add(path);
    return { bytes: new Uint8Array(bytes), path };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

  const files = Object.fromEntries(normalized.map(({ bytes, path }) => [
    `${rootDirectory}/${path}`,
    [bytes, { mtime: zipEpoch }]
  ]));
  return zipSync(files, { level: 6 });
}
