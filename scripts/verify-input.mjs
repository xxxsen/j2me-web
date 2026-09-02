import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_INPUT_TEST_PORT || 4187);
const baseUrl = `http://127.0.0.1:${port}`;
const chromePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"]
});
let browser;

const expected = [
  ["ArrowUp", -1], ["w", -1],
  ["ArrowDown", -2], ["s", -2],
  ["ArrowLeft", -3], ["a", -3],
  ["ArrowRight", -4], ["d", -4],
  ["Enter", -5], ["q", -6], ["e", -7],
  ...Array.from({ length: 10 }, (_, digit) => [String(digit), 48 + digit])
];

try {
  await waitForServer(baseUrl);
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/?fixture=${encodeURIComponent("魔塔")}&autostart=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForFunction(() => window.__j2meDemoRuntime?.getState() === "RUNNING", {
    timeout: 90000
  });

  let sequence = 0;
  for (const [browserKey, mobileKey] of expected) {
    const probe = await dispatchAndRead(page, browserKey, sequence);
    assert.equal(probe.keyCode, mobileKey, `${browserKey} must reach the MIDlet as ${mobileKey}`);
    sequence = probe.sequence;
  }
  await page.click("#keypad-button");
  const touchExpected = [
    ["UP", -1], ["DOWN", -2], ["LEFT", -3], ["RIGHT", -4], ["FIRE", -5],
    ["SOFT_LEFT", -6], ["SOFT_RIGHT", -7], ["STAR", 42], ["POUND", 35],
    ...Array.from({ length: 10 }, (_, digit) => [`DIGIT_${digit}`, 48 + digit])
  ];
  for (const [action, mobileKey] of touchExpected) {
    const probe = await dispatchTouchAndRead(page, action, sequence).catch((error) => {
      throw new Error(`${action} did not reach the FreeJ2ME input queue`, { cause: error });
    });
    assert.equal(probe.keyCode, mobileKey, `${action} must reach the MIDlet as ${mobileKey}`);
    sequence = probe.sequence;
  }
  console.log(`Input contract verified for ${expected.length} browser keys and ${touchExpected.length} touch keys.`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function dispatchTouchAndRead(page, action, previousSequence) {
  await page.evaluate((name) => {
    const button = document.querySelector(`[data-j2me-action="${name}"]`);
    button.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true
    }));
    button.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true
    }));
  }, action);
  await page.waitForFunction((previous) =>
    (window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1")?.sequence ?? 0) > previous,
  { timeout: 30000 }, previousSequence);
  return page.evaluate(() => window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1"));
}

async function dispatchAndRead(page, browserKey, previousSequence) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await page.focus(".j2me-runtime-source");
    await page.keyboard.press(browserKey);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const probe = await page.evaluate(() =>
      window.__j2meDemoRuntime.getValidationProbe("J2ME_INPUT_V1"));
    if (probe?.sequence > previousSequence) return probe;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${browserKey} did not reach the FreeJ2ME input queue`);
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
