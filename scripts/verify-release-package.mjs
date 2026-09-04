import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";
import puppeteer from "puppeteer-core";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const rootDirectory = `j2me-web-v${packageJson.version}-runtime`;
const archivePath = join(projectRoot, "release", `${rootDirectory}.zip`);
const testJarBytes = process.env.J2ME_RELEASE_TEST_JAR
  ? await readFile(resolve(process.env.J2ME_RELEASE_TEST_JAR))
  : null;
const testJar = testJarBytes ? {
  sha256: createHash("sha256").update(testJarBytes).digest("hex"),
  sizeBytes: testJarBytes.byteLength
} : null;
const temporaryRoot = await mkdtemp(join(tmpdir(), "j2me-web-release-smoke-"));
let browser;
let server;

try {
  const entries = unzipSync(await readFile(archivePath));
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith(`${rootDirectory}/`) || path.endsWith("/")) {
      throw new Error("Invalid release archive entry");
    }
    const output = join(temporaryRoot, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
  }

  const serveRoot = join(temporaryRoot, rootDirectory);
  server = createServer(async (request, response) => {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>j2me-web release smoke</title>");
        return;
      }
      if (pathname === "/game.jar" && testJarBytes) {
        response.setHeader("Content-Type", "application/java-archive");
        response.end(testJarBytes);
        return;
      }
      const file = resolve(serveRoot, `.${pathname}`);
      if (relative(serveRoot, file).startsWith("..")) throw new Error("Invalid path");
      response.setHeader("Content-Type", contentType(file));
      response.end(await readFile(file));
    } catch {
      response.statusCode = 404;
      response.end("Not found");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Release smoke server unavailable");

  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async (jar) => {
    const runtime = await import("/j2me-runtime.js");
    const response = await fetch("/audio-transcoder.wasm");
    const module = await WebAssembly.compileStreaming(Promise.resolve(response));
    const worker = new Worker("/audio-transcoder.worker.js");
    const workerReady = await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("Audio worker initialization timed out")), 30000);
      worker.addEventListener("message", (event) => {
        if (event.data?.replyFor !== 1) return;
        clearTimeout(timeout);
        if (event.data.error) rejectReady(new Error(event.data.error));
        else resolveReady(event.data.value);
      });
      worker.addEventListener("error", (event) => rejectReady(new Error(event.message)));
      worker.postMessage({ cmd: "init", id: 1, module });
    });
    worker.terminate();
    let mounted = null;
    if (jar) {
      const target = document.createElement("div");
      document.body.append(target);
      const instance = runtime.createRuntime({
        sessionId: "release-smoke",
        contentDigest: jar.sha256,
        source: {
          kind: "J2ME_JAR_V1",
          name: "game.jar",
          url: new URL("/game.jar", location.href).href,
          sizeBytes: jar.sizeBytes,
          sha256: jar.sha256
        },
        adapter: {
          adapterKind: "J2ME_MINIJVM_WEB",
          adapterId: "j2me-minijvm-web",
          runtimeBaseUrl: new URL("/", location.href).href,
          storage: "HOST",
          viewport: { width: 240, height: 320 },
          scalingMode: "SHARP_FIT"
        }
      }, { frameWindow: window });
      await Promise.race([
        instance.mount(target),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Runtime mount timed out")), 90000))
      ]);
      const frameDeadline = performance.now() + 10000;
      while ((instance.getFrameCount() ?? 0) < 1 && performance.now() < frameDeadline) {
        await new Promise((resolveFrame) => setTimeout(resolveFrame, 50));
      }
      mounted = {
        canvas: instance.getCanvas() instanceof HTMLCanvasElement,
        frameCount: instance.getFrameCount(),
        state: instance.getState()
      };
      await instance.exit();
    }
    return {
      crossOriginIsolated,
      createRuntime: typeof runtime.createRuntime,
      mounted,
      mountRuntime: typeof runtime.mountRuntime,
      validateRuntimeConfig: typeof runtime.validateRuntimeConfig,
      workerReady
    };
  }, testJar);
  assert.deepEqual({ ...result, mounted: null }, {
    crossOriginIsolated: true,
    createRuntime: "function",
    mounted: null,
    mountRuntime: "function",
    validateRuntimeConfig: "function",
    workerReady: true
  });
  if (testJar) {
    assert.equal(result.mounted?.canvas, true);
    assert.equal(result.mounted?.state, "RUNNING");
    assert.ok(result.mounted?.frameCount > 0, "release runtime must render at least one frame");
  } else {
    assert.equal(result.mounted, null);
  }
  console.log(`Release bundle and embedded audio worker verified in Chrome for v${packageJson.version}`);
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporaryRoot, { force: true, recursive: true });
}

function contentType(path) {
  return ({
    ".data": "application/octet-stream",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm"
  })[extname(path)] || "application/octet-stream";
}
