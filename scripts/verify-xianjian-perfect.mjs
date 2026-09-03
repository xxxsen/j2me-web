import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_XIANJIAN_PERFECT_TEST_PORT || 4203);
const fixtureName = "仙剑奇侠传完美版";
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

try {
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

  try {
    await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
      timeout: 60000
    });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      state: window.__j2meDemoRuntime?.getState?.() ?? "MISSING",
      frames: window.__j2meDemoRuntime?.getFrameCount?.() ?? 0,
      log: document.querySelector("#console-output")?.textContent ?? ""
    })).catch(() => ({ state: "PAGE_UNRESPONSIVE", frames: 0, log: "" }));
    throw new Error(`仙剑奇侠传完美版未进入运行状态：${JSON.stringify(diagnostics)}`, { cause: error });
  }

  const firstFrames = await page.evaluate(() => window.__j2meDemoRuntime.getFrameCount());
  const viewport = await page.evaluate(() => {
    const canvas = window.__j2meDemoRuntime.getCanvas();
    return { width: canvas.width, height: canvas.height };
  });
  assert.deepEqual(viewport, { width: 176, height: 208 }, "游戏必须使用原生 Nokia 画面尺寸");
  await delay(3000);
  const secondFrames = await page.evaluate(() => window.__j2meDemoRuntime.getFrameCount());
  assert.ok(secondFrames >= firstFrames + 30,
    `游戏启动后必须持续渲染，3 秒只推进 ${secondFrames - firstFrames} 帧`);

  const previousInput = await page.evaluate(() =>
    window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0);
  await page.focus(".j2me-runtime-source");
  await page.keyboard.press("Enter");
  await page.waitForFunction((previous) =>
    (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > previous,
  { timeout: 5000 }, previousInput);
  await page.waitForFunction((previous) =>
    window.__j2meDemoRuntime.getFrameCount() >= previous + 30,
  { timeout: 5000 }, secondFrames);

  const result = await page.evaluate(() => ({
    state: window.__j2meDemoRuntime.getState(),
    frames: window.__j2meDemoRuntime.getFrameCount(),
    input: window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1"),
    log: document.querySelector("#console-output")?.textContent ?? ""
  }));
  assert.equal(result.state, "RUNNING");
  assert.equal(result.input?.keyCode, -5, "Enter 必须到达 MIDlet FIRE 键");
  assert.doesNotMatch(result.log, /(?:OutOfMemoryError|Wasm trap|J2ME_RUNTIME_UNAVAILABLE)/u);
  console.log(`仙剑奇侠传完美版启动回归通过：${result.frames} 帧，Enter=${result.input.keyCode}。`);
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
