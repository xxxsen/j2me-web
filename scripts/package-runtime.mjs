import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "release");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const runtimeManifest = JSON.parse(await readFile(join(projectRoot, "runtime-manifest.json"), "utf8"));
if (runtimeManifest.packageVersion !== packageJson.version) throw new Error("Runtime manifest version mismatch");
const tag = process.env.RELEASE_TAG || `v${packageJson.version}`;
const commit = process.env.RELEASE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8"
}).trim();
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag) || !/^[a-f0-9]{40}$/u.test(commit)) {
  throw new Error("Invalid release identity");
}

const sources = [
  "public/runtime/runtime.js",
  "public/runtime/runtime.wasm",
  "public/runtime/runtime.data",
  "public/runtime/runtime.worker.js",
  "public/runtime/audio-transcoder.wasm",
  "public/runtime/audio-transcoder.glue.js",
  "public/runtime/audio-transcoder.worker.js",
  "web/runtime-api.js",
  "web/runtime-controller.js",
  "web/checkpoint-codec.js",
  "web/audio-policy.js",
  "web/input-probe.js",
  "web/key-state-probe.js",
  "web/gc-probe.js",
  "web/graphics-probe.js",
  "web/video-scaling.js",
  "web/compatibility-profiles.js",
  "web/virtual-keypad.js",
  "web/media-transcoder.js",
  "runtime-manifest.json",
  "THIRD_PARTY_NOTICES.md"
];

await rm(outputRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });
const assets = [];
for (const relativePath of sources) {
  const source = join(projectRoot, relativePath);
  const filename = basename(relativePath);
  const destination = join(outputRoot, filename);
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  const fileStat = await stat(destination);
  assets.push({
    filename,
    observedSha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: fileStat.size
  });
}

const metadata = {
  adapterAbi: "j2me-rms",
  assets,
  commit,
  digestPolicy: "OBSERVED_CACHE_INTEGRITY_ONLY",
  repository: "https://github.com/xxxsen/j2me-web",
  schemaVersion: 1,
  sourceCommits: {
    freej2meOnMinijvm: "abc7aebca03b914df289e8e2f566c3a8b4173464",
    freej2mePlus: "f416be17e069ec9658b868ce0a580992b9270097",
    ffmpeg: "db69d06eeeab4f46da15030a80d539efb4503ca8",
    miniJVM: "1533f6f9d858cdd67f3262811f2410b1a42a7255"
  },
  tag
};
await writeFile(join(outputRoot, "j2me-runtime-release.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Packaged ${assets.length} runtime assets in ${outputRoot}`);
