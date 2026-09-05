import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const port = Number(process.env.J2ME_LIFECYCLE_TEST_PORT || 4207);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "inherit"]
});
let browser;
const failures = [];
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(error); console.error(`FAIL ${name}: ${error.stack}`); }
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* Server startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
  await check("abort during download cannot create a surface after exit", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const result = await page.evaluate(async () => {
        const { createRuntime, sha256Hex } = await import("/runtime-api.js");
        const bytes = Uint8Array.of(80, 75, 3, 4);
        const sha256 = await sha256Hex(bytes);
        let finishFetch;
        const originalFetch = window.fetch;
        window.fetch = () => new Promise((resolve) => { finishFetch = () => resolve(new Response(bytes)); });
        let factoryCalls = 0;
        const abort = new AbortController();
        const target = document.createElement("div"); document.body.append(target);
        const runtime = createRuntime({ sessionId: "abort", contentDigest: sha256,
          source: { kind: "J2ME_JAR_V1", name: "probe.jar", url: `${location.origin}/probe.jar`, sizeBytes: 4, sha256 },
          adapter: { adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web", runtimeBaseUrl: `${location.origin}/runtime/`,
            storage: "HOST", viewport: { width: 240, height: 320 } } },
        { frameWindow: window, signal: abort.signal, moduleFactory: () => { factoryCalls++; return {}; } });
        const mounting = runtime.mount(target).then(() => "mounted", (error) => error.name);
        abort.abort();
        const exited = await Promise.race([runtime.exit().then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
        finishFetch(); window.fetch = originalFetch;
        const mountResult = await mounting;
        return { exited, state: runtime.getState(), mountResult, factoryCalls, children: target.childElementCount };
      });
      assert.deepEqual(result, { exited: true, state: "EXITED", mountResult: "AbortError", factoryCalls: 0, children: 0 });
    } finally { await page.close(); }
  });
  await check("late initialization is disposed and post-READY aborts reach FAILED", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const result = await page.evaluate(async () => {
        const { createRuntime, sha256Hex } = await import("/runtime-api.js");
        const bytes = Uint8Array.of(80, 75, 3, 4);
        const sha256 = await sha256Hex(bytes);
        const url = URL.createObjectURL(new Blob([bytes]));
        const config = { sessionId: "fault", contentDigest: sha256,
          source: { kind: "J2ME_JAR_V1", name: "probe.jar", url, sizeBytes: 4, sha256 },
          adapter: { adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web", runtimeBaseUrl: `${location.origin}/runtime/`,
            storage: "HOST", viewport: { width: 240, height: 320 } } };
        const target = document.createElement("div"); document.body.append(target);
        let options, finish, calls = 0, disposals = 0;
        const aborted = createRuntime(config, { frameWindow: window, moduleFactory: (value) => {
          options = value;
          options.PThread = { terminateAllThreads: () => { disposals++; } };
          return new Promise((resolve) => { finish = () => resolve({ ...options, callMain: () => { calls++; } }); });
        } });
        const pending = aborted.mount(target).catch((error) => error.name);
        while (!finish) await new Promise((resolve) => setTimeout(resolve, 5));
        await aborted.exit();
        const earlyDisposed = disposals > 0;
        finish(); await pending; await Promise.resolve();
        let activeOptions;
        const events = [];
        const runtime = createRuntime(config, { frameWindow: window, moduleFactory: async (value) => {
          activeOptions = value; value.onRuntimeInitialized();
          return { FS: { analyzePath: () => ({ exists: false }) },
            callMain: () => value.print("HOST_BRIDGE_READY"), PThread: { terminateAllThreads() {} } };
        } });
        runtime.subscribe((event) => events.push(event));
        await runtime.mount(target);
        activeOptions.onAbort("simulated Wasm failure");
        await new Promise((resolve) => setTimeout(resolve, 20));
        const state = runtime.getState();
        await runtime.exit();
        URL.revokeObjectURL(url);
        return { earlyDisposed, calls, state, children: target.childElementCount,
          fatalEvents: events.filter((event) => event.type === "FATAL_ERROR").length };
      });
      assert.deepEqual(result, { earlyDisposed: true, calls: 0, state: "FAILED", children: 0, fatalEvents: 1 });
    } finally { await page.close(); }
  });
  await check("checkpoint pause and resume failures cannot leave a frozen RUNNING instance", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const results = await page.evaluate(async () => {
        const { createRuntime, sha256Hex } = await import("/runtime-api.js");
        const bytes = Uint8Array.of(80, 75, 3, 4);
        const sha256 = await sha256Hex(bytes);
        const url = URL.createObjectURL(new Blob([bytes]));
        const results = [];
        try { for (const failedState of [1, 0]) {
          const events = [];
          let state = 0, disposals = 0;
          const target = document.createElement("div"); document.body.append(target);
          const runtime = createRuntime({ sessionId: "pause-failure", contentDigest: sha256,
            source: { kind: "J2ME_JAR_V1", name: "probe.jar", url, sizeBytes: 4, sha256 },
            adapter: { adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web", runtimeBaseUrl: `${location.origin}/runtime/`,
              storage: "HOST", viewport: { width: 240, height: 320 } } },
          { frameWindow: window, moduleFactory: async (options) => {
            options.onRuntimeInitialized();
            return { callMain: () => options.print("HOST_BRIDGE_READY"),
              FS: { analyzePath: () => ({ exists: true }), readdir: () => ["save"],
                stat: () => ({ mode: 1, size: 1 }), isDir: () => false, readFile: () => Uint8Array.of(1) },
              _j2me_request_pause: (value) => { state = value === failedState ? -1 : value; },
              _j2me_get_pause_state: () => state,
              PThread: { terminateAllThreads: () => { disposals++; } } };
          } });
          runtime.subscribe((event) => events.push(event));
          await runtime.mount(target);
          const error = await runtime.checkpoint().then(() => null, (error) => error.message);
          await runtime.exit().catch(() => undefined);
          results.push({ error, state: runtime.getState(), disposals, children: target.childElementCount,
            fatalEvents: events.filter((event) => event.type === "FATAL_ERROR").length });
        } } finally { URL.revokeObjectURL(url); }
        return results;
      });
      for (const result of results) assert.deepEqual(result, {
        error: "J2ME_PAUSE_FAILED", state: "FAILED", disposals: 1, children: 0, fatalEvents: 1
      });
    } finally { await page.close(); }
  });
  await check("IDBFS isolates games and restores without deleting another game", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const result = await page.evaluate(async () => {
        const { createRuntime, sha256Hex } = await import("/runtime-api.js");
        const { encodeCheckpoint, decodeCheckpoint } = await import("/checkpoint-codec.js");
        const { default: factory } = await import("/runtime/runtime.js");
        const root = "/appdata/freej2meonminijvm.jar/rms/rms";
        const aDigest = await sha256Hex(Uint8Array.of(80, 75, 3, 4, 1));
        const bDigest = await sha256Hex(Uint8Array.of(80, 75, 3, 4, 2));
        async function mount(n, digest, restorePayload) {
          const bytes = Uint8Array.of(80, 75, 3, 4, n);
          const url = URL.createObjectURL(new Blob([bytes]));
          let module;
          const r = createRuntime({ sessionId: `storage-${n}`, contentDigest: digest,
            source: { kind: "J2ME_JAR_V1", name: "probe.jar", url, sizeBytes: bytes.length, sha256: digest },
            adapter: { adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web", runtimeBaseUrl: `${location.origin}/runtime/`,
              storage: "BROWSER", viewport: { width: 240, height: 320 } } },
          { frameWindow: window, restorePayload, moduleFactory: async (options) => {
            options.noInitialRun = true;
            module = await factory(options);
            // This fixture exercises real Emscripten FS/IDBFS without launching Java.
            module.callMain = () => options.print("HOST_BRIDGE_READY");
            let state = 0;
            module._j2me_request_pause = (value) => { state = value; };
            module._j2me_get_pause_state = () => state;
            module.pauseMainLoop = () => {};
            module.resumeMainLoop = () => {};
            options.print("HOST_BRIDGE_READY");
            return module;
          } });
          await r.mount(document.querySelector("#screen-surface"));
          URL.revokeObjectURL(url);
          return { r, module };
        }
        const a = await mount(1, aDigest);
        a.module.FS.mkdirTree(`${root}/game-a`);
        a.module.FS.writeFile(`${root}/game-a/state`, Uint8Array.of(42));
        await a.r.exit();
        const b = await mount(2, bDigest);
        const bHasSave = b.r.getCheckpointAvailability().available;
        await b.r.exit();
        const c = await mount(2, bDigest, encodeCheckpoint(bDigest, [{ path: "game-b/state", bytes: Uint8Array.of(99) }]));
        await c.r.exit();
        const d = await mount(1, aDigest);
        const files = decodeCheckpoint((await d.r.checkpoint()).bytes, aDigest).files;
        await d.r.exit();
        return { bHasSave, files: files.map((file) => [file.path, [...file.bytes]]) };
      });
      assert.equal(result.bHasSave, false);
      assert.deepEqual(result.files, [["game-a/state", [42]]]);
    } finally { await page.close(); }
  });
  await check("transcoder frees custom AVIO buffers on repeated decode failures", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      const sizes = await page.evaluate(async () => {
        const base = `${location.origin}/runtime/`;
        const code = `importScripts(${JSON.stringify(`${base}audio-transcoder.glue.js`)});
          onmessage=async()=>{const m=await createFfmpegAudioTranscoder({locateFile:()=>${JSON.stringify(`${base}audio-transcoder.wasm`)}});
            const p=m._malloc(4);m.HEAPU8.set([1,2,3,4],p);const sizes=[];
            for(let n=0;n<=10000;n++){if(n%2000===0)sizes.push(m.HEAPU8.byteLength);
              if(n<10000){const out=m._transcode(p,4);if(out)m._ob_free(out);}}
            m._free(p);postMessage(sizes);};`;
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        const worker = new Worker(url);
        try { return await new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage(true);
        }); } finally { worker.terminate(); URL.revokeObjectURL(url); }
      });
      assert.equal(sizes.at(-1), sizes[1], `Wasm memory must stabilize after warmup: ${sizes}`);
    } finally { await page.close(); }
  });
  // The self-authored MIDlet is compiled by build:runtime; no commercial fixtures are required.
  if (!process.env.J2ME_LIFECYCLE_STORAGE_ONLY) {
    const jar = await readFile(new URL("../.cache/test-runtime/lifecycle.jar", import.meta.url));
    await check("real MIDlet lifecycle and frame isolation", async () => {
      const page = await browser.newPage();
      page.on("pageerror", (error) => console.error(`Browser error: ${error.message}`));
      page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
      try {
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          if (request.url() === `${origin}/lifecycle.jar`) void request.respond({ status: 200, contentType: "application/java-archive", body: jar });
          else void request.continue();
        });
        await page.goto(origin);
        await page.evaluate(async () => {
          const { createRuntime, sha256Hex } = await import("/runtime-api.js");
          const bytes = new Uint8Array(await (await fetch("/lifecycle.jar")).arrayBuffer());
          const digest = await sha256Hex(bytes);
          const policy = document.createElement("meta");
          policy.httpEquiv = "Content-Security-Policy";
          policy.content = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'unsafe-inline'";
          document.head.append(policy);
          window.mountProbe = async (restorePayload) => {
            const iframe = document.createElement("iframe");
            iframe.width = "800"; iframe.height = "600";
            document.body.replaceChildren(iframe);
            const frameWindow = iframe.contentWindow;
            delete window.probeError;
            const liveWorkers = new Set();
            const NativeWorker = frameWindow.Worker;
            frameWindow.Worker = class extends NativeWorker {
              constructor(...args) { super(...args); liveWorkers.add(this); }
              terminate() { liveWorkers.delete(this); return super.terminate(); }
            };
            window.probeWorkerCount = () => liveWorkers.size;
            const target = frameWindow.document.createElement("div");
            target.style.height = "500px";
            frameWindow.document.body.append(target);
            window.probeLogs = [];
            window.probeFrame = iframe;
            window.probeRuntime = createRuntime({ sessionId: "lifecycle", contentDigest: digest,
              source: { kind: "J2ME_JAR_V1", name: "lifecycle.jar", url: `${location.origin}/lifecycle.jar`, sizeBytes: bytes.length, sha256: digest },
              adapter: { adapterKind: "J2ME_MINIJVM_WEB", adapterId: "j2me-minijvm-web", runtimeBaseUrl: `${location.origin}/runtime/`,
                storage: "HOST", viewport: { width: 240, height: 320 } } },
            { frameWindow, restorePayload, onDiagnostic: ({ message }) => probeLogs.push(message) });
            window.probeMount = probeRuntime.mount(target).catch((error) => { window.probeError = error.message; });
            await probeMount;
          };
          void window.mountProbe();
        });
        await page.waitForFunction(() => window.probeRuntime?.getState() === "RUNNING" || window.probeError, { timeout: 90000 });
        assert.equal(await page.evaluate(() => probeRuntime.getState()), "RUNNING");
        await page.waitForFunction(() => probeLogs.filter((line) => line.includes("LIFECYCLE_TICK")).length > 5);
        await page.evaluate(() => probeRuntime.setInput("FIRE", true));
        await page.waitForFunction(() => probeLogs.some((line) => line.includes("LIFECYCLE_KEY -5")));
        await page.evaluate(() => probeRuntime.setInput("FIRE", false));
        const beforeBlur = await page.evaluate(() => probeLogs.filter((line) => line.includes("LIFECYCLE_KEY -5")).length);
        await page.evaluate(() => {
          probeRuntime.setInput("FIRE", true);
          probeFrame.contentWindow.dispatchEvent(new probeFrame.contentWindow.Event("blur"));
          probeRuntime.setInput("FIRE", true);
          probeRuntime.setInput("FIRE", false);
        });
        await page.waitForFunction((count) => probeLogs.filter((line) => line.includes("LIFECYCLE_KEY -5")).length >= count + 2, {}, beforeBlur);
        await page.evaluate(() => probeRuntime.pause());
        const pausedFrames = await page.evaluate(() => probeRuntime.getFrameCount());
        const before = await page.evaluate(() => probeLogs.filter((line) => /LIFECYCLE_(TICK|KEY)/u.test(line)));
        await page.evaluate(() => { probeRuntime.setInput("FIRE", true); probeRuntime.unlockAudio(); });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const after = await page.evaluate(() => probeLogs.filter((line) => /LIFECYCLE_(TICK|KEY)/u.test(line)));
        assert.deepEqual(after, before, "Java ticks and inputs must stop after pause resolves");
        assert.equal(await page.evaluate(() => probeRuntime.getFrameCount()), pausedFrames,
          "the core presentation counter must stop during pause");
        await page.evaluate(() => probeRuntime.resume());
        await page.waitForFunction((length) => probeLogs.filter((line) => /LIFECYCLE_(TICK|KEY)/u.test(line)).length > length, {}, after.length);
        for (const mode of ["SHARP_FIT", "SCALE2X", "INTEGER_NEAREST"]) {
          const size = await page.evaluate(async (mode) => {
            probeRuntime.setScalingMode(mode);
            const image = await createImageBitmap(await probeRuntime.screenshot());
            const result = [image.width, image.height]; image.close(); return result;
          }, mode);
          assert.deepEqual(size, [240, 320]);
        }
        const saved = await page.evaluate(async () => {
          await probeRuntime.pause();
          const checkpoint = [...(await probeRuntime.checkpoint()).bytes];
          const tick = Number(probeLogs.filter((line) => line.includes("LIFECYCLE_TICK")).at(-1).match(/LIFECYCLE_TICK (\d+)/u)[1]) & 255;
          return { checkpoint, tick };
        });
        assert.ok(saved.checkpoint.length > 44);
        await page.evaluate(() => probeRuntime.exit());
        assert.equal(await page.evaluate(() => probeFrame.contentDocument.querySelector("canvas")), null);
        assert.equal(await page.evaluate(() => probeWorkerCount()), 0);
        await page.evaluate((bytes) => window.mountProbe(Uint8Array.from(bytes)), saved.checkpoint);
        await page.waitForFunction(() => probeLogs.some((line) => line.includes("LIFECYCLE_RESTORED")));
        const restored = await page.evaluate(() => Number(probeLogs.find((line) => line.includes("LIFECYCLE_RESTORED")).match(/LIFECYCLE_RESTORED (\d+)/u)[1]));
        assert.equal(restored, saved.tick, "a new MIDlet must read the exact checkpointed RMS value");
        await page.evaluate(() => probeRuntime.exit());
        assert.equal(await page.evaluate(() => probeWorkerCount()), 0);
      } catch (error) {
        console.error(await page.evaluate(() => window.probeLogs?.slice(-30)));
        throw error;
      } finally { await page.close(); }
    });
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} lifecycle checks failed`);
} finally { await browser?.close(); server.kill("SIGTERM"); }
