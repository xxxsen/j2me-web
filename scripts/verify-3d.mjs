import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_3D_TEST_PORT || 4196);
const fixtureName = process.env.J2ME_3D_TEST_FIXTURE || "都市摩天楼";
const expectedApi = process.env.J2ME_3D_TEST_API || "M3G";
const timeoutMs = Number(process.env.J2ME_3D_TEST_TIMEOUT_MS || 240000);
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
    "J2ME_3D_TEST_TIMEOUT_MS must be an integer between 60000 and 600000");
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

  const initialFrames = await page.evaluate(() => window.__j2meDemoRuntime.getFrameCount());
  const deadline = Date.now() + timeoutMs;
  const navigation = expectedApi === "MASCOT"
    ? ["e"]
    : ["q", "Enter", "q", "Enter", "ArrowDown", "q", "Enter", "ArrowUp", "q", "Enter"];
  const holdMs = expectedApi === "MASCOT" ? 750 : 180;
  const press = async (key) => {
    await page.focus(".j2me-runtime-source");
    await page.keyboard.down(key);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    await page.keyboard.up(key);
    await new Promise((resolve) => setTimeout(resolve, 1000 - holdMs));
  };
  if (expectedApi === "MASCOT") {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await press("ArrowDown");
    await press("5");
    await new Promise((resolve) => setTimeout(resolve, 7000));
  }
  let attempt = 0;
  let probe = null;
  while (Date.now() < deadline) {
    probe = await page.evaluate(() => window.__j2meDemoRuntime.getValidationProbe("J2ME_3D_V1"));
    if (probe?.api === expectedApi && probe.backend === "WEBGL2" && probe.event === "frame") break;
    if (!navigation.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const key = navigation[attempt % navigation.length];
    await press(key);
    attempt += 1;
  }

  if (probe?.event !== "frame") {
    const failure = await page.evaluate(() => ({
      console: document.querySelector("#console-output")?.textContent ?? "",
      input: window.__j2meDemoRuntime?.getValidationProbe("J2ME_INPUT_V1"),
      keyState: window.__j2meDemoRuntime?.getValidationProbe("J2ME_KEY_STATE_V1"),
      state: window.__j2meDemoRuntime?.getState()
    }));
    await page.screenshot({ path: "/tmp/j2me-3d-failure.png", fullPage: true });
    console.error(`3D fixture did not reach a hardware frame: ${JSON.stringify({ probe, failure })}`);
  }

  assert.equal(probe?.api, expectedApi, `the fixture must reach the ${expectedApi} renderer`);
  assert.equal(probe?.backend, "WEBGL2", `${expectedApi} must render with WebGL2, got ${JSON.stringify(probe)}`);
  assert.equal(probe?.event, "frame", "backend creation alone is not a rendered-frame success");
  assert.ok(probe.items > 0, "the verified WebGL2 frame must contain geometry");

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const visual = await page.evaluate(() => {
    const runtime = window.__j2meDemoRuntime;
    const canvas = runtime.getCanvas();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let opaque = 0;
    for (let offset = 0; offset < pixels.length; offset += 16) {
      if (pixels[offset + 3] > 0) opaque += 1;
      colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
    }
    return { colors: colors.size, frames: runtime.getFrameCount(), opaque };
  });
  assert.ok(visual.frames > initialFrames, "presentation frames must advance while M3G renders");
  assert.ok(visual.opaque > 0, "the M3G frame must be visible");
  assert.ok(visual.colors >= 4, `the M3G frame must contain visible color variation, got ${visual.colors}`);

  console.log(`${expectedApi} WebGL2 verified for ${fixtureName}: ${probe.items} draw items, ${
    visual.colors
  } sampled colors, ${visual.frames - initialFrames} presentation frames advanced.`);
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
