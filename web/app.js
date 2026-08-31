const fixtureSelect = document.querySelector("#fixture-select");
const viewportSelect = document.querySelector("#viewport-select");
const jarFile = document.querySelector("#jar-file");
const fileLabel = document.querySelector("#file-label");
const startButton = document.querySelector("#start-button");
const reloadButton = document.querySelector("#reload-button");
const canvas = document.querySelector("#canvas");
const gameDisplay = document.querySelector("#game-display");
const stage = document.querySelector("#stage");
const audioButton = document.querySelector("#audio-button");
const viewButton = document.querySelector("#view-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const placeholder = document.querySelector("#screen-placeholder");
const badge = document.querySelector("#runtime-badge");
const consoleOutput = document.querySelector("#console-output");

let started = false;
let zoomedView = true;
let mirrorFrame = 0;
let activeGameName = "";
let gameViewport = { width: 240, height: 320 };
const logLines = ["页面已就绪。"];
const displayContext = gameDisplay.getContext("2d", { alpha: false });
displayContext.imageSmoothingEnabled = false;
const lcdSource = { x: 2, y: 32, width: 240, height: 320 };
// Persist only RecordStore data. Keeping the sibling runtime configuration in
// MEMFS avoids carrying frontend-specific settings between builds and leaves
// each game launch free to recreate compatible defaults.
const persistenceRoot = "/appdata/freej2meonminijvm.jar/rms/rms";

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

function resumeMiniAudio() {
  const devices = window.miniaudio?.devices || [];
  let resumed = false;
  for (const device of devices) {
    const context = device?.webaudio;
    if (context && context.state !== "running") {
      context.resume().catch(() => {});
      resumed = true;
    }
  }
  return resumed || devices.length > 0;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function automaticViewport(gameName) {
  // This MIDlet overrides Canvas.getWidth()/getHeight() with 128x144. The
  // emulator LCD itself stays 240x320, so without this crop it occupies only
  // the upper-left part of the output.
  if (/仙剑奇侠传/i.test(gameName)) return { width: 128, height: 144 };
  return { width: 240, height: 320 };
}

function applyGameViewport(logChange = false) {
  const selected = parseViewport(viewportSelect.value);
  gameViewport = selected || automaticViewport(activeGameName);
  gameDisplay.width = gameViewport.width;
  gameDisplay.height = gameViewport.height;
  gameDisplay.style.aspectRatio = `${gameViewport.width} / ${gameViewport.height}`;
  displayContext.imageSmoothingEnabled = false;
  if (logChange && started) {
    appendLog(`游戏画面区域：${gameViewport.width} × ${gameViewport.height}${selected ? "（手动）" : "（自动）"}`);
  }
}

function mirrorGameScreen() {
  if (started && zoomedView && canvas.width && canvas.height) {
    // The miniJVM AWT Frame is positioned at the top-left of the GLFW form.
    // Its two-pixel border and 30-pixel title bar precede the 240x320 LCD.
    const sourceWidth = gameViewport.width / 240 * lcdSource.width;
    const sourceHeight = gameViewport.height / 320 * lcdSource.height;
    try {
      displayContext.drawImage(
        canvas,
        lcdSource.x,
        lcdSource.y,
        sourceWidth,
        sourceHeight,
        0,
        0,
        gameDisplay.width,
        gameDisplay.height
      );
    } catch (_) {
      // The WebGL surface can be unavailable for a frame while GLFW resizes it.
    }
  }
  mirrorFrame = requestAnimationFrame(mirrorGameScreen);
}

function applyViewMode() {
  canvas.classList.toggle("zoom-source", zoomedView);
  gameDisplay.classList.toggle("visible", zoomedView && started);
  viewButton.textContent = zoomedView ? "显示模拟按键" : "放大游戏画面";
  // GLFW installs its keyboard listeners on the runtime canvas. Keep that
  // element focused even while the enlarged mirror is the visible surface.
  canvas.focus();
}

function forwardPointer(event) {
  if (!zoomedView) return;
  event.preventDefault();
  if (event.type === "pointerdown") gameDisplay.setPointerCapture(event.pointerId);
  const outputRect = gameDisplay.getBoundingClientRect();
  const sourceRect = canvas.getBoundingClientRect();
  const lcdX = lcdSource.x + (event.clientX - outputRect.left) / outputRect.width * gameViewport.width / 240 * lcdSource.width;
  const lcdY = lcdSource.y + (event.clientY - outputRect.top) / outputRect.height * gameViewport.height / 320 * lcdSource.height;
  const clientX = sourceRect.left + lcdX / canvas.width * sourceRect.width;
  const clientY = sourceRect.top + lcdY / canvas.height * sourceRect.height;
  const type = event.type === "pointerdown" ? "mousedown" : event.type === "pointerup" || event.type === "pointercancel" ? "mouseup" : "mousemove";
  canvas.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: event.button,
    buttons: event.buttons
  }));
  canvas.focus();
  resumeMiniAudio();
}

async function loadFixtures() {
  try {
    const response = await fetch("/api/fixtures");
    const fixtures = await response.json();
    fixtureSelect.replaceChildren(new Option("选择测试游戏", ""));
    for (const fixture of fixtures) fixtureSelect.add(new Option(fixture.name, fixture.url));
    if (fixtures.length) {
      const params = new URLSearchParams(location.search);
      const requestedFixture = params.get("fixture");
      const requestedIndex = Number.parseInt(requestedFixture || "", 10);
      const matchIndex = Number.isInteger(requestedIndex) && String(requestedIndex) === requestedFixture
        ? requestedIndex
        : fixtures.findIndex((fixture) => fixture.name === requestedFixture || fixture.name.includes(requestedFixture || "\0"));
      fixtureSelect.selectedIndex = matchIndex >= 0 && matchIndex < fixtures.length ? matchIndex + 1 : 1;
      if (params.has("autostart")) startButton.click();
    } else fixtureSelect.options[0].textContent = "未发现 fixture 游戏";
  } catch (error) {
    fixtureSelect.replaceChildren(new Option("fixture 读取失败", ""));
    appendLog(error, true);
  }
}

jarFile.addEventListener("change", () => {
  const [file] = jarFile.files;
  fileLabel.textContent = file?.name || "选择 .jar 文件";
  if (file) fixtureSelect.value = "";
});

fixtureSelect.addEventListener("change", () => {
  if (fixtureSelect.value) {
    jarFile.value = "";
    fileLabel.textContent = "选择 .jar 文件";
  }
});

viewportSelect.addEventListener("change", () => applyGameViewport(true));

async function readGame() {
  const [file] = jarFile.files;
  let game;
  if (file) game = { name: file.name, bytes: await file.arrayBuffer() };
  else {
    if (!fixtureSelect.value) throw new Error("请先选择一个 JAR 游戏。");
    const response = await fetch(fixtureSelect.value);
    if (!response.ok) throw new Error(`读取 fixture 失败：HTTP ${response.status}`);
    game = { name: fixtureSelect.selectedOptions[0].textContent, bytes: await response.arrayBuffer() };
  }

  const signature = new Uint8Array(game.bytes, 0, Math.min(4, game.bytes.byteLength));
  const isZipArchive = signature.length === 4
    && signature[0] === 0x50 && signature[1] === 0x4b
    && ((signature[2] === 0x03 && signature[3] === 0x04)
      || (signature[2] === 0x05 && signature[3] === 0x06)
      || (signature[2] === 0x07 && signature[3] === 0x08));
  if (!isZipArchive) throw new Error(`${game.name} 不是有效的 JAR/ZIP 文件，请检查下载内容和扩展名。`);
  return game;
}

function loadRuntime(game) {
  window.Module = {
    arguments: [
      "-Xmx128M",
      "-bootclasspath", "/lib/minijvm_rt.jar",
      "-cp", "/lib/glfw_gui.jar:/lib/xgui.jar:/lib/webj2me.jar",
      "org.j2me.web.WebLauncher"
    ],
    canvas,
    locateFile(path) {
      return `/runtime/${path}`;
    },
    preRun: [function preloadGame() {
      if (!FS.analyzePath(persistenceRoot).exists) FS.mkdirTree(persistenceRoot);
      const finishPreload = () => {
        FS.writeFile("/game.jar", new Uint8Array(game.bytes));
        appendLog(`已写入虚拟文件系统：/game.jar (${game.bytes.byteLength} bytes)`);
        console.info("[j2me-web] game mounted; initializing miniJVM");
      };
      const idbfs = FS.filesystems?.IDBFS;
      if (!idbfs) {
        appendLog("浏览器持久化文件系统不可用，将使用临时存档。", true);
        finishPreload();
        return;
      }
      FS.mount(idbfs, { autoPersist: true }, persistenceRoot);
      addRunDependency("j2me-web-idbfs");
      FS.syncfs(true, (error) => {
        if (error) appendLog(`读取浏览器存档失败：${error}`, true);
        else appendLog("浏览器存档已载入。");
        finishPreload();
        removeRunDependency("j2me-web-idbfs");
      });
    }],
    print(message) {
      appendLog(message);
      console.log(message);
    },
    printErr(message) {
      appendLog(message, true);
      console.error(message);
    },
    setStatus(message) {
      if (message) updateBadge(message, "running");
    },
    onRuntimeInitialized() {
      console.info("[j2me-web] WebAssembly runtime initialized; starting miniJVM");
      updateBadge(`正在运行：${game.name}`, "running");
      audioButton.disabled = false;
      viewButton.disabled = false;
      applyViewMode();
      // AudioContext creation happens when a game first opens a player. Retrying
      // briefly lets the initial Start click also satisfy browser autoplay rules.
      let audioAttempts = 0;
      const audioTimer = setInterval(() => {
        if (resumeMiniAudio() || ++audioAttempts > 40) clearInterval(audioTimer);
      }, 250);
    },
    onAbort(reason) {
      updateBadge("运行时已中止", "error");
      appendLog(reason, true);
      reloadButton.hidden = false;
    }
  };

  const script = document.createElement("script");
  script.src = "/runtime/runtime.js";
  script.async = true;
  script.addEventListener("error", () => {
    updateBadge("运行时未构建", "error");
    appendLog("无法加载 /runtime/runtime.js，请先运行 npm run build:runtime。", true);
    reloadButton.hidden = false;
  });
  document.body.append(script);
}

startButton.addEventListener("click", async () => {
  if (started) return;
  startButton.disabled = true;
  updateBadge("正在读取游戏…", "running");

  try {
    const game = await readGame();
    activeGameName = game.name;
    started = true;
    applyGameViewport(true);
    appendLog(`准备启动：${game.name}`);
    placeholder.hidden = true;
    canvas.classList.add("ready", "zoom-source");
    gameDisplay.classList.add("visible");
    if (!mirrorFrame) mirrorGameScreen();
    loadRuntime(game);
  } catch (error) {
    updateBadge("启动失败", "error");
    appendLog(error, true);
    startButton.disabled = false;
  }
});

reloadButton.addEventListener("click", () => location.reload());

audioButton.addEventListener("click", () => {
  const active = resumeMiniAudio();
  audioButton.textContent = active ? "声音已启用" : "等待游戏音频";
  appendLog(active ? "Web Audio 已恢复。" : "游戏尚未创建音频设备，请进入有音乐的场景后再点一次。");
});

viewButton.addEventListener("click", () => {
  zoomedView = !zoomedView;
  applyViewMode();
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch (error) {
    appendLog(`无法进入全屏：${error.message}`, true);
  }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
});

for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
  gameDisplay.addEventListener(type, forwardPointer);
}

window.addEventListener("error", (event) => {
  if (!started) return;
  updateBadge("运行时错误", "error");
  appendLog(event.error?.stack || event.message, true);
  reloadButton.hidden = false;
});

loadFixtures();
