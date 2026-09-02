import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_AUDIO_TEST_PORT || 4189);
const fixtureName = process.env.J2ME_AUDIO_TEST_FIXTURE || "仙剑奇侠传";
const timeoutMs = Number(process.env.J2ME_AUDIO_TEST_TIMEOUT_MS || 240000);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

try {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60000 && timeoutMs <= 600000,
    "J2ME_AUDIO_TEST_TIMEOUT_MS must be an integer between 60000 and 600000");
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--no-sandbox"
    ]
  });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?fixture=${encodeURIComponent(fixtureName)}&autostart=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
    timeout: 90000
  });

  // This is the sole game input: leave “按任意键继续”, then remain on the main
  // menu. A long press is needed because this title polls GameCanvas key state.
  await delay(25000);
  const previousInput = await page.evaluate(() =>
    window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
  await page.focus(".j2me-runtime-source");
  await page.keyboard.down("Enter");
  await delay(750);
  await page.keyboard.up("Enter");
  await page.waitForFunction((previous) => {
    const probe = window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1");
    return probe?.sequence > previous && probe.keyCode === -5;
  }, { timeout: 30000 }, previousInput);

  const initialFrames = await page.evaluate(() => window.__j2meDemoRuntime.getFrameCount());
  await page.waitForFunction(() => {
    const frameWindow = window.__j2meDemoRuntime.getCanvas().ownerDocument.defaultView;
    return (frameWindow.__j2meWebAudio?.stats?.begins ?? 0) > 0;
  }, { timeout: timeoutMs });

  const result = await page.evaluate(() => {
    const runtime = window.__j2meDemoRuntime;
    const frameWindow = runtime.getCanvas().ownerDocument.defaultView;
    const audio = frameWindow.__j2meWebAudio;
    return {
      state: runtime.getState(),
      frames: runtime.getFrameCount(),
      stats: audio?.stats,
      items: Array.from(audio?.items?.values() ?? []).map((item) => ({
        buffered: Boolean(item.buffer),
        playRequested: item.playRequested,
        running: item.running
      })),
      log: document.querySelector("#console-output")?.textContent ?? ""
    };
  });

  assert.equal(result.state, "RUNNING", "runtime must remain running when menu music begins");
  assert.ok(result.frames > initialFrames, "rendering must continue while menu MIDI is prepared");
  assert.equal(result.stats?.begins, 1, "the menu must begin exactly one audio item");
  assert.ok(result.items.some((item) => item.buffered && item.playRequested && item.running),
    "the menu MIDI must be decoded and running in Web Audio");
  assert.doesNotMatch(result.log, /Sound\s*:.*(?:NullPointerException|Exception)/u,
    "the MIDlet audio setup must not fail");

  console.log(`Menu audio verified for ${fixtureName}: ${result.frames - initialFrames} frames advanced; `
    + `${result.stats.begins} Web Audio item running after one J2ME Enter input.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await delay(100);
  }
  throw new Error(`test server did not start at ${url}`);
}
