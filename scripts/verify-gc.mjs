import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_GC_TEST_PORT || 4188);
const requiredCycles = Number(process.env.J2ME_GC_TEST_CYCLES || 3);
const fixtureName = process.env.J2ME_GC_TEST_FIXTURE || "魔塔";
const maximumStopWorldMs = Number(process.env.J2ME_GC_TEST_MAX_STW_MS || 2000);
const timeoutMs = Number(process.env.J2ME_GC_TEST_TIMEOUT_MS || requiredCycles * 30000 + 120000);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

try {
  assert.ok(Number.isSafeInteger(requiredCycles) && requiredCycles >= 2 && requiredCycles <= 120,
    "J2ME_GC_TEST_CYCLES must be an integer between 2 and 120");
  assert.ok(Number.isSafeInteger(maximumStopWorldMs) && maximumStopWorldMs >= 100,
    "J2ME_GC_TEST_MAX_STW_MS must be an integer of at least 100");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60000 && timeoutMs <= 3600000,
    "J2ME_GC_TEST_TIMEOUT_MS must be an integer between 60000 and 3600000");
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?fixture=${encodeURIComponent(fixtureName)}&autostart=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
    timeout: 90000
  });

  const samples = [];
  let sequence = 0;
  let frames = await page.evaluate(() => window.__j2meDemoRuntime.getFrameCount());
  const deadline = Date.now() + timeoutMs;
  while (samples.length < requiredCycles && Date.now() < deadline) {
    await page.focus(".j2me-runtime-source");
    await page.keyboard.press(samples.length % 2 ? "ArrowDown" : "Enter");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await page.evaluate(() => ({
      runtimeState: window.__j2meDemoRuntime.getState(),
      frames: window.__j2meDemoRuntime.getFrameCount(),
      gc: window.__j2meDemoRuntime.getValidationProbe("J2ME_GC_V1")
    }));
    assert.equal(state.runtimeState, "RUNNING", "runtime must remain running while GC is active");
    if (state.gc?.sequence > sequence) {
      assert.ok(state.frames > frames, "rendering must advance across a GC cycle");
      samples.push(state.gc);
      sequence = state.gc.sequence;
      frames = state.frames;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.equal(samples.length, requiredCycles, `expected ${requiredCycles} completed browser GC cycles`);
  assert.ok(samples.some((sample) => sample.reclaimedBytes > 0), "at least one cycle must reclaim Java objects");
  assert.ok(samples.every((sample) => sample.afterBytes <= sample.beforeBytes), "post-GC heap must not exceed pre-GC heap");
  assert.ok(samples.every((sample) => sample.stopWorldMs <= maximumStopWorldMs),
    `every stop-the-world pause must stay within ${maximumStopWorldMs} ms`);
  const postGcHeaps = samples.map((sample) => sample.afterBytes);
  const minimumPostGcHeap = Math.min(...postGcHeaps);
  assert.ok(postGcHeaps.at(-1) <= minimumPostGcHeap + 16 * 1024 * 1024,
    "post-GC Java heap must remain within 16 MiB of the observed floor");

  const previousInput = await page.evaluate(() =>
    window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
  await page.focus(".j2me-runtime-source");
  await page.keyboard.press("Enter");
  await page.waitForFunction((previous) =>
    (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > previous,
  { timeout: 30000 }, previousInput);

  console.log(`GC contract verified for ${fixtureName}: ${samples.length} cycles; reclaimed ${
    samples.reduce((total, sample) => total + sample.reclaimedBytes, 0)
  } bytes; post-GC heaps ${postGcHeaps.join(",")} bytes; max STW ${
    Math.max(...samples.map((sample) => sample.stopWorldMs))
  } ms; max pre-STW wait ${Math.max(...samples.map((sample) => sample.waitMs))} ms.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`test server did not start at ${url}`);
}
