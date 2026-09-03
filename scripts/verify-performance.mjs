import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_PERF_TEST_PORT || 4197);
const fixtureName = process.env.J2ME_PERF_TEST_FIXTURE || "魔塔";
const sampleCount = Number(process.env.J2ME_PERF_TEST_SAMPLES || 3);
const maximumMedianStartupMs = Number(process.env.J2ME_PERF_TEST_MAX_MEDIAN_STARTUP_MS || 30000);
const maximumInputLatencyMs = Number(process.env.J2ME_PERF_TEST_MAX_INPUT_MS || 3000);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

try {
  assert.ok(Number.isSafeInteger(sampleCount) && sampleCount >= 1 && sampleCount <= 10,
    "J2ME_PERF_TEST_SAMPLES must be an integer between 1 and 10");
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--no-sandbox"]
  });

  const samples = [];
  for (let index = 0; index < sampleCount; index++) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const startedAt = performance.now();
    await page.goto(`${baseUrl}/?fixture=${encodeURIComponent(fixtureName)}&autostart=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
      timeout: 90000
    });
    const readyMs = performance.now() - startedAt;
    await page.waitForFunction(() => window.__j2meDemoRuntime?.getFrameCount() >= 5, { timeout: 10000 });
    const firstFramesMs = performance.now() - startedAt;
    await waitForInputReady(page);
    const interactiveMs = performance.now() - startedAt;
    const previousInput = await page.evaluate(() =>
      window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
    const inputStartedAt = performance.now();
    await page.focus(".j2me-runtime-source");
    await page.keyboard.press("Enter");
    await page.waitForFunction((previous) =>
      (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > previous,
    { timeout: maximumInputLatencyMs }, previousInput);
    const inputMs = performance.now() - inputStartedAt;
    samples.push({ readyMs, firstFramesMs, interactiveMs, inputMs });
    await context.close();
  }

  const medianReadyMs = median(samples.map((sample) => sample.readyMs));
  const medianFirstFramesMs = median(samples.map((sample) => sample.firstFramesMs));
  const medianInteractiveMs = median(samples.map((sample) => sample.interactiveMs));
  const worstInputMs = Math.max(...samples.map((sample) => sample.inputMs));
  assert.ok(medianInteractiveMs <= maximumMedianStartupMs,
    `median Chrome interactive startup ${medianInteractiveMs.toFixed(0)} ms exceeds ${maximumMedianStartupMs} ms`);
  assert.ok(worstInputMs <= maximumInputLatencyMs,
    `worst input latency ${worstInputMs.toFixed(0)} ms exceeds ${maximumInputLatencyMs} ms`);
  console.log(`Chrome performance verified for ${fixtureName}: median READY ${medianReadyMs.toFixed(0)} ms, ` +
    `median first 5 frames ${medianFirstFramesMs.toFixed(0)} ms, ` +
    `median interactive ${medianInteractiveMs.toFixed(0)} ms, worst input ${worstInputMs.toFixed(0)} ms; ` +
    `samples ${samples.map((sample) => sample.readyMs.toFixed(0)).join(",")} ms.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function waitForInputReady(page) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const previous = await page.evaluate(() =>
      window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
    await page.focus(".j2me-runtime-source");
    await page.keyboard.press("ArrowDown");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const current = await page.evaluate(() =>
      window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
    if (current > previous) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("MIDlet input queue did not become interactive within 30 seconds");
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
