import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_SOAK_TEST_PORT || 4198);
const fixtureName = process.env.J2ME_SOAK_TEST_FIXTURE || "魔塔";
const durationMs = Number(process.env.J2ME_SOAK_TEST_DURATION_MS || 15 * 60 * 1000);
const sampleIntervalMs = Number(process.env.J2ME_SOAK_TEST_SAMPLE_MS || 15000);
const requiredGcCycles = Number(process.env.J2ME_SOAK_TEST_GC_CYCLES || 3);
const maximumStopWorldMs = Number(process.env.J2ME_SOAK_TEST_MAX_STW_MS || 2000);
const maximumJsHeapGrowth = Number(process.env.J2ME_SOAK_TEST_MAX_JS_HEAP_GROWTH || 64 * 1024 * 1024);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const fatalRuntimePattern = /(?:FATAL_ERROR|HOST_BRIDGE_FAILED|GC canceled|VM coordination lock timeout|out of memory|deadlock|RuntimeError|unreachable|wasm trap|Aborted\()/iu;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

try {
  assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 60000 && durationMs <= 3600000,
    "J2ME_SOAK_TEST_DURATION_MS must be an integer between 60000 and 3600000");
  assert.ok(Number.isSafeInteger(sampleIntervalMs) && sampleIntervalMs >= 1000 && sampleIntervalMs <= 60000,
    "J2ME_SOAK_TEST_SAMPLE_MS must be an integer between 1000 and 60000");
  assert.ok(Number.isSafeInteger(requiredGcCycles) && requiredGcCycles >= 1 && requiredGcCycles <= 120,
    "J2ME_SOAK_TEST_GC_CYCLES must be an integer between 1 and 120");
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
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const sourceUrl = message.location().url || "";
    if (sourceUrl.endsWith("/favicon.ico")) return;
    browserErrors.push(`${message.text()}${sourceUrl ? ` (${sourceUrl})` : ""}`);
  });
  await page.goto(`${baseUrl}/?fixture=${encodeURIComponent(fixtureName)}&autostart=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
    timeout: 90000
  });
  const inputReadyDeadline = Date.now() + 30000;
  let inputReady = false;
  while (!inputReady && Date.now() < inputReadyDeadline) {
    const previous = await page.evaluate(() =>
      window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
    await page.focus(".j2me-runtime-source");
    await page.keyboard.press("ArrowDown");
    await delay(500);
    inputReady = await page.evaluate((sequence) =>
      (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > sequence,
    previous);
  }
  assert.ok(inputReady, "MIDlet input queue must become ready before the soak starts");
  await page.keyboard.press("Enter");
  await delay(2000);

  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const initial = await readRuntimeSample(page);
  const samples = [initial];
  const gcSamples = [];
  let gcSequence = initial.gc?.sequence ?? 0;
  let nextProgressAt = startedAt + 60000;
  let nextScreenshotAt = startedAt + 60000;
  let screenshotCount = 0;
  let pauseVerified = false;
  let inputIndex = 0;
  // Keep the title active without repeatedly confirming menu entries (which
  // could eventually select a game's own Exit command during a long run).
  const inputs = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];

  while (Date.now() < deadline) {
    await delay(Math.min(sampleIntervalMs, Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) break;

    if (!pauseVerified && Date.now() - startedAt >= Math.min(durationMs / 3, 5 * 60 * 1000)) {
      await page.evaluate(() => window.__j2meDemoRuntime.pause());
      assert.equal(await page.evaluate(() => window.__j2meDemoRuntime.getState()), "PAUSED");
      await delay(500);
      await page.evaluate(() => window.__j2meDemoRuntime.resume());
      assert.equal(await page.evaluate(() => window.__j2meDemoRuntime.getState()), "RUNNING");
      await delay(500);
      pauseVerified = true;
    }

    await page.focus(".j2me-runtime-source");
    const previousInputSequence = samples.at(-1).inputSequence;
    await page.keyboard.press(inputs[inputIndex % inputs.length]);
    inputIndex += 1;
    await page.waitForFunction((previous) =>
      (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > previous,
    { timeout: 10000 }, previousInputSequence);
    const sample = await readRuntimeSample(page);
    samples.push(sample);
    assert.equal(sample.state, "RUNNING", "runtime must remain running throughout the soak");
    assert.ok(sample.inputSequence > samples.at(-2).inputSequence,
      "each soak input must continue reaching the MIDlet event queue");
    assert.doesNotMatch(sample.log, fatalRuntimePattern,
      "runtime diagnostics must not contain a fatal, deadlock, GC timeout, OOM or Wasm trap");
    if (sample.gc?.sequence > gcSequence) {
      gcSamples.push(sample.gc);
      gcSequence = sample.gc.sequence;
    }

    if (Date.now() >= nextScreenshotAt) {
      const screenshot = await page.evaluate(async () => {
        const blob = await window.__j2meDemoRuntime.screenshot();
        return { size: blob.size, type: blob.type };
      });
      assert.equal(screenshot.type, "image/png", "soak screenshots must remain PNG blobs");
      assert.ok(screenshot.size > 0, "soak screenshots must contain pixels");
      screenshotCount += 1;
      nextScreenshotAt += 60000;
    }

    if (Date.now() >= nextProgressAt) {
      const elapsedMinutes = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`Chrome soak ${elapsedMinutes} min: ${sample.frames - initial.frames} frames, `
        + `${gcSamples.length} GC cycles, JS heap ${(sample.jsHeapBytes / 1048576).toFixed(1)} MiB.`);
      nextProgressAt += 60000;
    }
  }

  const final = await readRuntimeSample(page);
  assert.equal(final.state, "RUNNING", "runtime must still be running after the soak");
  assert.ok(final.frames > initial.frames, "presentation frames must advance during the soak");
  assert.ok(samples.every((sample, index) => index === 0 || sample.frames > samples[index - 1].frames),
    "presentation frames must advance at every soak sample");
  assert.ok(pauseVerified, "pause and resume must complete during the soak");
  assert.ok(screenshotCount >= Math.floor(durationMs / 60000) - 1,
    "the runtime must keep producing screenshots throughout the soak");
  assert.equal(browserErrors.length, 0, `Chrome emitted errors: ${browserErrors.join(" | ")}`);
  assert.ok(gcSamples.length >= requiredGcCycles,
    `expected at least ${requiredGcCycles} completed GC cycles, got ${gcSamples.length}`);
  assert.ok(gcSamples.every((sample) => sample.afterBytes <= sample.beforeBytes),
    "every completed GC cycle must reduce or preserve the Java heap");
  assert.ok(gcSamples.every((sample) => sample.stopWorldMs <= maximumStopWorldMs),
    `every stop-the-world pause must stay within ${maximumStopWorldMs} ms`);
  const postGcHeaps = gcSamples.map((sample) => sample.afterBytes);
  assert.ok(postGcHeaps.at(-1) <= Math.min(...postGcHeaps) + 16 * 1024 * 1024,
    "post-GC Java heap must remain within 16 MiB of the observed floor");
  const jsHeaps = samples.map((sample) => sample.jsHeapBytes).filter(Number.isFinite);
  assert.ok(jsHeaps.at(-1) <= Math.min(...jsHeaps) + maximumJsHeapGrowth,
    `Chrome JS heap must remain within ${maximumJsHeapGrowth} bytes of the observed floor`);

  console.log(`Chrome soak verified for ${fixtureName}: ${((Date.now() - startedAt) / 60000).toFixed(1)} min, `
    + `${final.frames - initial.frames} frames, ${gcSamples.length} GC cycles, ${screenshotCount} screenshots, `
    + `max STW ${Math.max(...gcSamples.map((sample) => sample.stopWorldMs))} ms, JS heap `
    + `${(Math.min(...jsHeaps) / 1048576).toFixed(1)}-${(Math.max(...jsHeaps) / 1048576).toFixed(1)} MiB.`);
} catch (error) {
  const pages = await browser?.pages();
  const failurePage = pages?.at(-1);
  const diagnostics = await failurePage?.evaluate(() => ({
    state: window.__j2meDemoRuntime?.getState(),
    input: window.__j2meDemoRuntime?.getValidationProbe("J2ME_INPUT_V1"),
    gc: window.__j2meDemoRuntime?.getValidationProbe("J2ME_GC_V1"),
    log: document.querySelector("#console-output")?.textContent ?? ""
  })).catch(() => null);
  if (diagnostics) console.error(`Soak diagnostics: ${JSON.stringify(diagnostics)}`);
  await failurePage?.screenshot({ path: "/tmp/j2me-soak-failure.png", fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function readRuntimeSample(page) {
  const runtime = await page.evaluate(() => ({
    state: window.__j2meDemoRuntime.getState(),
    frames: window.__j2meDemoRuntime.getFrameCount(),
    gc: window.__j2meDemoRuntime.getValidationProbe("J2ME_GC_V1"),
    inputSequence: window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0,
    log: document.querySelector("#console-output")?.textContent ?? ""
  }));
  const metrics = await page.metrics();
  return { ...runtime, jsHeapBytes: metrics.JSHeapUsedSize };
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
