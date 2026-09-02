import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MIDlet startup cannot block the browser's GLFW event loop", async () => {
  const launcher = await readFile(new URL("../src/java/org/j2me/web/WebLauncher.java", import.meta.url), "utf8");
  assert.match(launcher, /Thread\s+appLoader\s*=\s*new Thread/u);
  assert.match(launcher, /appLoader\.start\(\);[\s\S]*Glfw\.executeMainLoop\(\);/u);
});

test("the browser compatibility profile reaches the miniJVM frontend", async () => {
  const runtimeApi = await readFile(new URL("../web/runtime-api.js", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build-runtime.sh", import.meta.url), "utf8");

  assert.match(runtimeApi, /\/appdata\/freej2meonminijvm\.jar\/j2me-web-profile\.properties/u);
  assert.match(build, /MiniJvmFrontendProfileTest/u);
});

test("the release builds a pinned FFmpeg audio-only transcoder", async () => {
  const build = await readFile(new URL("../scripts/build-runtime.sh", import.meta.url), "utf8");
  assert.match(build, /FFMPEG_COMMIT="db69d06eeeab4f46da15030a80d539efb4503ca8"/u);
  assert.match(build, /--disable-network/u);
  assert.match(build, /--enable-decoder=.*amrnb.*amrwb.*mp3/u);
  assert.match(build, /audio-transcoder\.wasm/u);
  assert.doesNotMatch(build, /--enable-libx264|--enable-gpl/u);
});
