import { createRuntime, sha256Hex } from "./runtime-api.js";

const fixtureSelect = document.querySelector("#fixture-select");
const viewportSelect = document.querySelector("#viewport-select");
const scalingSelect = document.querySelector("#scaling-select");
const jarFile = document.querySelector("#jar-file");
const fileLabel = document.querySelector("#file-label");
const checkpointFile = document.querySelector("#checkpoint-file");
const checkpointFileLabel = document.querySelector("#checkpoint-file-label");
const startButton = document.querySelector("#start-button");
const reloadButton = document.querySelector("#reload-button");
const screenSurface = document.querySelector("#screen-surface");
const stage = document.querySelector("#stage");
const audioButton = document.querySelector("#audio-button");
const pauseButton = document.querySelector("#pause-button");
const checkpointButton = document.querySelector("#checkpoint-button");
const viewButton = document.querySelector("#view-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const badge = document.querySelector("#runtime-badge");
const consoleOutput = document.querySelector("#console-output");

let runtime = null;
let fixtureCatalog = [];
let objectUrl = null;
let viewMode = "LCD";
const logLines = ["页面已就绪。"];

function appendLog(message, isError = false) {
  const text = String(message);
  logLines.push(`${isError ? "[error] " : ""}${text}`);
  if (logLines.length > 160) logLines.splice(0, logLines.length - 160);
  consoleOutput.textContent = logLines.join("\n");
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function updateBadge(message, state = "") {
  badge.textContent = message;
  badge.className = `badge ${state}`.trim();
}

function automaticViewport(gameName) {
  return /仙剑奇侠传/iu.test(gameName) ? { width: 128, height: 144 } : { width: 240, height: 320 };
}

function selectedViewport(gameName = "") {
  const match = /^(\d+)x(\d+)$/u.exec(viewportSelect.value);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : automaticViewport(gameName);
}

async function loadFixtures() {
  try {
    const response = await fetch("/api/fixtures");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    fixtureCatalog = await response.json();
    fixtureSelect.replaceChildren(new Option("选择测试游戏", ""));
    for (const fixture of fixtureCatalog) fixtureSelect.add(new Option(fixture.name, fixture.url));
    if (!fixtureCatalog.length) {
      fixtureSelect.options[0].textContent = "未发现 fixture 游戏";
      return;
    }
    const params = new URLSearchParams(location.search);
    const requested = params.get("fixture");
    const requestedIndex = Number.parseInt(requested || "", 10);
    const matchIndex = Number.isInteger(requestedIndex) && String(requestedIndex) === requested
      ? requestedIndex
      : fixtureCatalog.findIndex((fixture) => fixture.name === requested || fixture.name.includes(requested || "\0"));
    fixtureSelect.selectedIndex = matchIndex >= 0 && matchIndex < fixtureCatalog.length ? matchIndex + 1 : 1;
    if (params.has("autostart")) void startGame();
  } catch (error) {
    fixtureSelect.replaceChildren(new Option("fixture 读取失败", ""));
    appendLog(error, true);
  }
}

async function readSource() {
  const [file] = jarFile.files;
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    return {
      kind: "J2ME_JAR_V1",
      name: file.name,
      sha256,
      sizeBytes: bytes.byteLength,
      url: objectUrl
    };
  }
  const fixture = fixtureCatalog.find((entry) => entry.url === fixtureSelect.value);
  if (!fixture) throw new Error("请先选择一个 JAR 游戏。");
  return {
    kind: "J2ME_JAR_V1",
    name: fixture.name,
    sha256: fixture.sha256,
    sizeBytes: fixture.sizeBytes,
    url: new URL(fixture.url, location.href).href
  };
}

function subscribeRuntime(active) {
  active.subscribe((event) => {
    if (event.type === "LOAD_PROGRESS") {
      const total = event.totalBytes === null ? "?" : event.totalBytes;
      updateBadge(`正在加载：${event.loadedBytes}/${total}`, "running");
    } else if (event.type === "READY") {
      updateBadge("游戏正在运行", "running");
    } else if (event.type === "STATE_CHANGED") {
      if (event.state === "PAUSED") {
        pauseButton.textContent = "继续";
        updateBadge("游戏已暂停");
      } else if (event.state === "RUNNING") {
        pauseButton.textContent = "暂停";
        updateBadge("游戏正在运行", "running");
      } else if (event.state === "EXITED") {
        updateBadge("运行时已退出");
        reloadButton.hidden = false;
      }
    } else if (event.type === "CHECKPOINT_AVAILABILITY_CHANGED") {
      checkpointButton.disabled = !event.availability.available;
    } else if (event.type === "EXIT_REQUESTED") {
      appendLog("MIDlet 请求退出，宿主运行时正在清理。");
    } else if (event.type === "FATAL_ERROR") {
      updateBadge("运行时错误", "error");
      appendLog(event.code, true);
      reloadButton.hidden = false;
    }
  });
}

async function startGame() {
  if (runtime) return;
  startButton.disabled = true;
  updateBadge("正在准备游戏…", "running");
  try {
    const source = await readSource();
    const [restoreFile] = checkpointFile.files;
    const restorePayload = restoreFile ? new Uint8Array(await restoreFile.arrayBuffer()) : null;
    runtime = createRuntime({
      sessionId: crypto.randomUUID(),
      contentDigest: source.sha256,
      source,
      adapter: {
        adapterKind: "J2ME_MINIJVM_WEB",
        adapterId: "j2me-minijvm-web",
        runtimeBaseUrl: new URL("/runtime/", location.href).href,
        storage: "BROWSER",
        scalingMode: scalingSelect.value,
        viewport: selectedViewport(source.name)
      }
    }, {
      frameWindow: window,
      restorePayload,
      onDiagnostic: ({ message }) => {
        const isError = /^\[error\]\s*/u.test(message);
        appendLog(message.replace(/^\[error\]\s*/u, ""), isError);
      }
    });
    window.__j2meDemoRuntime = runtime;
    subscribeRuntime(runtime);
    appendLog(`准备启动：${source.name}`);
    await runtime.mount(screenSurface);
    audioButton.disabled = false;
    pauseButton.disabled = false;
    viewButton.disabled = false;
    checkpointButton.disabled = !runtime.getCheckpointAvailability().available;
  } catch (error) {
    runtime = null;
    window.__j2meDemoRuntime = null;
    updateBadge("启动失败", "error");
    appendLog(error instanceof Error ? error.message : error, true);
    startButton.disabled = false;
    reloadButton.hidden = false;
  }
}

jarFile.addEventListener("change", () => {
  const [file] = jarFile.files;
  fileLabel.textContent = file?.name || "选择 .jar 文件";
  if (file) fixtureSelect.value = "";
});

fixtureSelect.addEventListener("change", () => {
  if (!fixtureSelect.value) return;
  jarFile.value = "";
  fileLabel.textContent = "选择 .jar 文件";
});

checkpointFile.addEventListener("change", () => {
  checkpointFileLabel.textContent = checkpointFile.files[0]?.name || "选择 .j2mecp 文件";
});

viewportSelect.addEventListener("change", () => {
  if (!runtime) return;
  const fixtureName = fixtureSelect.selectedOptions[0]?.textContent || jarFile.files[0]?.name || "";
  const viewport = selectedViewport(fixtureName);
  runtime.setViewport(viewport);
  appendLog(`游戏画面区域：${viewport.width} × ${viewport.height}`);
});

scalingSelect.addEventListener("change", () => {
  if (!runtime) return;
  runtime.setScalingMode(scalingSelect.value);
  const label = scalingSelect.selectedOptions[0]?.textContent || scalingSelect.value;
  appendLog(`画面清晰度：${label}`);
});

startButton.addEventListener("click", () => void startGame());
reloadButton.addEventListener("click", () => location.reload());

audioButton.addEventListener("click", () => {
  const active = runtime?.unlockAudio() ?? false;
  audioButton.textContent = active ? "声音已启用" : "等待游戏音频";
});

pauseButton.addEventListener("click", async () => {
  if (!runtime) return;
  try {
    if (runtime.getState() === "RUNNING") await runtime.pause();
    else if (runtime.getState() === "PAUSED") await runtime.resume();
  } catch (error) { appendLog(error, true); }
});

checkpointButton.addEventListener("click", async () => {
  if (!runtime) return;
  checkpointButton.disabled = true;
  try {
    const checkpoint = await runtime.checkpoint();
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([checkpoint.bytes], { type: "application/octet-stream" }));
    link.href = url;
    link.download = `j2me-checkpoint-${Date.now()}.j2mecp`;
    link.click();
    URL.revokeObjectURL(url);
    appendLog(`宿主 checkpoint 已导出：${checkpoint.bytes.byteLength} bytes`);
  } catch (error) { appendLog(error, true); }
  finally { checkpointButton.disabled = !runtime.getCheckpointAvailability().available; }
});

viewButton.addEventListener("click", () => {
  if (!runtime) return;
  viewMode = viewMode === "LCD" ? "EMULATOR" : "LCD";
  runtime.setViewMode(viewMode);
  viewButton.textContent = viewMode === "LCD" ? "显示模拟按键" : "放大游戏画面";
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch (error) { appendLog(`无法进入全屏：${error.message}`, true); }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
});

window.addEventListener("pagehide", () => { void runtime?.exit(); }, { once: true });
window.addEventListener("error", (event) => {
  if (!runtime) return;
  updateBadge("运行时错误", "error");
  appendLog(event.error?.stack || event.message, true);
  reloadButton.hidden = false;
});

void loadFixtures();
