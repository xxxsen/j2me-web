import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bundleRuntimeApi,
  composeAudioWorker,
  createDeterministicZip
} from "./release-package-lib.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "release");
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const runtimeManifest = JSON.parse(await readFile(join(projectRoot, "runtime-manifest.json"), "utf8"));
if (runtimeManifest.packageVersion !== packageJson.version) throw new Error("Runtime manifest version mismatch");

const expectedTag = `v${packageJson.version}`;
const tag = process.env.RELEASE_TAG || expectedTag;
const commit = process.env.RELEASE_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8"
}).trim();
if (tag !== expectedTag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag) ||
  !/^[a-f0-9]{40}$/u.test(commit)) {
  throw new Error("Invalid release identity");
}

const runtimeAssetSources = [
  ["runtime.js", "public/runtime/runtime.js"],
  ["runtime-loader.js", "web/runtime-loader.js"],
  ["runtime.wasm", "public/runtime/runtime.wasm"],
  ["runtime.data", "public/runtime/runtime.data"],
  ["runtime.worker.js", "public/runtime/runtime.worker.js"],
  ["audio-transcoder.wasm", "public/runtime/audio-transcoder.wasm"]
];
const runtimeAssetNames = [
  "j2me-runtime.js",
  "runtime.js",
  "runtime-loader.js",
  "runtime.wasm",
  "runtime.data",
  "runtime.worker.js",
  "audio-transcoder.wasm",
  "audio-transcoder.worker.js"
];
if (JSON.stringify(runtimeManifest.assets) !== JSON.stringify(runtimeAssetNames)) {
  throw new Error("Runtime manifest asset list mismatch");
}

const documentationSources = [
  ["README.md", "README.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["docs/ARCHITECTURE.md", "docs/ARCHITECTURE.md"],
  ["docs/CHECKPOINTS.md", "docs/CHECKPOINTS.md"],
  ["docs/COMPATIBILITY.md", "docs/COMPATIBILITY.md"],
  ["docs/HOST_INTEGRATION.md", "docs/HOST_INTEGRATION.md"],
  ["docs/MAINTENANCE.md", "docs/MAINTENANCE.md"],
  ["docs/TESTING.md", "docs/TESTING.md"]
];

const temporaryRoot = await mkdtemp(join(tmpdir(), "j2me-web-release-"));
try {
  const bundledApiPath = join(temporaryRoot, "j2me-runtime.js");
  await bundleRuntimeApi(join(projectRoot, "web/runtime-api.js"), bundledApiPath);

  const audioGlue = await readFile(join(projectRoot, "public/runtime/audio-transcoder.glue.js"), "utf8");
  const audioWorker = await readFile(join(projectRoot, "web/audio-transcoder.worker.js"), "utf8");
  const runtimeEntries = [
    { path: "j2me-runtime.js", bytes: await readFile(bundledApiPath) },
    ...await Promise.all(runtimeAssetSources.map(async ([path, source]) => ({
      path,
      bytes: await readFile(join(projectRoot, source))
    }))),
    {
      path: "audio-transcoder.worker.js",
      bytes: Buffer.from(composeAudioWorker(audioGlue, audioWorker))
    }
  ];

  const packageEntries = [
    ...runtimeEntries,
    { path: "runtime-manifest.json", bytes: await readFile(join(projectRoot, "runtime-manifest.json")) },
    ...await Promise.all(documentationSources.map(async ([path, source]) => ({
      path,
      bytes: await readFile(join(projectRoot, source))
    })))
  ];
  const rootDirectory = `j2me-web-${tag}-runtime`;
  const archiveFilename = `${rootDirectory}.zip`;
  const checksumFilename = `${archiveFilename}.sha256`;
  const archive = createDeterministicZip(rootDirectory, packageEntries);
  const archiveSha256 = sha256(archive);

  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const archivePath = join(outputRoot, archiveFilename);
  await writeFile(archivePath, archive);
  await writeFile(join(outputRoot, checksumFilename), `${archiveSha256}  ${archiveFilename}\n`);

  const assets = runtimeEntries.map(({ path, bytes }) => ({
    filename: path,
    observedSha256: sha256(bytes),
    sizeBytes: bytes.byteLength
  }));
  const archiveStat = await stat(archivePath);
  const metadata = {
    adapterAbi: "j2me-rms",
    artifact: {
      checksumFilename,
      filename: archiveFilename,
      format: "zip",
      observedSha256: archiveSha256,
      rootDirectory,
      sizeBytes: archiveStat.size
    },
    assets,
    commit,
    digestPolicy: "RELEASE_ARCHIVE_AND_EXTRACTED_ASSETS_SHA256",
    packageVersion: packageJson.version,
    repository: "https://github.com/xxxsen/j2me-web",
    schemaVersion: 2,
    sourceCommits: {
      freej2meOnMinijvm: "abc7aebca03b914df289e8e2f566c3a8b4173464",
      freej2mePlus: "f416be17e069ec9658b868ce0a580992b9270097",
      ffmpeg: "db69d06eeeab4f46da15030a80d539efb4503ca8",
      miniJVM: "8d67a8c029836ad123eef0b5f7e8ab6298b2bb57"
    },
    tag
  };
  await writeFile(join(outputRoot, "j2me-runtime-release.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`Packaged ${assets.length} runtime assets in ${archiveFilename}`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
