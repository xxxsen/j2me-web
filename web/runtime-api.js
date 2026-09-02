import { CHECKPOINT_FORMAT, MAX_CHECKPOINT_BYTES, decodeCheckpoint, encodeCheckpoint } from "./checkpoint-codec.js";
import { installAudioActivation, resumeRuntimeAudio, suspendRuntimeAudio } from "./audio-policy.js";
import { createAudioTranscoder } from "./media-transcoder.js";
import { GameRuntimeController } from "./runtime-controller.js";
import { INPUT_PROBE_KIND, consumeInputProbe } from "./input-probe.js";
import { GC_PROBE_KIND, consumeGcProbe } from "./gc-probe.js";
import {
  encodeCoreProfile,
  resolveCompatibilityProfile,
  validCompatibilityProfileOverride
} from "./compatibility-profiles.js";
import {
  VIDEO_SCALING_MODES,
  computePresentationSize,
  scale2xPixels,
  validScalingMode
} from "./video-scaling.js";
import { VIRTUAL_KEY_ACTIONS, keyDescriptor } from "./virtual-keypad.js";

export const J2ME_ADAPTER_KIND = "J2ME_MINIJVM_WEB";
export const J2ME_ADAPTER_ID = "j2me-minijvm-web";
export const J2ME_ADAPTER_ABI = "j2me-rms";
export const J2ME_CONTENT_SOURCE = "J2ME_JAR_V1";

const persistenceRoot = "/appdata/freej2meonminijvm.jar/rms/rms";
const maximumJarBytes = 128 * 1024 * 1024;
const MEDIA_PROBE_KIND = "J2ME_MEDIA_V1";
const capabilities = Object.freeze({
  checkpoint: true,
  compatibilityProfiles: true,
  contentSources: Object.freeze([J2ME_CONTENT_SOURCE]),
  frameCounter: true,
  pause: true,
  screenshot: true,
  standardGamepad: true,
  virtualKeyInput: true,
  virtualKeyActions: VIRTUAL_KEY_ACTIONS,
  validationProbes: Object.freeze([INPUT_PROBE_KIND, GC_PROBE_KIND, MEDIA_PROBE_KIND]),
  videoScalingModes: VIDEO_SCALING_MODES,
  volume: true
});

export const runtimeAdapter = Object.freeze({
  adapterAbi: J2ME_ADAPTER_ABI,
  adapterId: J2ME_ADAPTER_ID,
  adapterKind: J2ME_ADAPTER_KIND,
  capabilities,
  checkpointFormat: CHECKPOINT_FORMAT,
  gameCompatibilityLine: "j2me-jar-v1",
  readableSaveAbis: Object.freeze(["j2me-rms-v1"]),
  saveAbi: "j2me-rms-v1"
});

export function createRuntime(config, options = {}) {
  validateRuntimeConfig(config);
  validateRuntimeOptions(options);
  return new GameRuntimeController(
    (target, reportProgress, reportExitRequested) => mountJ2me(
      config, target, options, reportProgress, reportExitRequested
    ),
    capabilities,
    options.signal ?? null
  );
}

export async function mountRuntime(config, target, options = {}) {
  const runtime = createRuntime(config, options);
  await runtime.mount(target);
  return runtime;
}

export function describeRuntime(config) {
  validateRuntimeConfig(config);
  return {
    crossOriginFrame: false,
    requiresThreads: true,
    runtimeBaseUrl: normalizedBase(config.adapter.runtimeBaseUrl)
  };
}

export function validateRuntimeConfig(config) {
  const adapter = config?.adapter;
  const source = config?.source;
  if (!config || typeof config !== "object" || !boundedText(config.sessionId, 200) ||
    !validDigest(config.contentDigest) || adapter?.adapterKind !== J2ME_ADAPTER_KIND ||
    adapter.adapterId !== J2ME_ADAPTER_ID || !validUrl(adapter.runtimeBaseUrl) ||
    !validStorage(adapter.storage) || !validViewport(adapter.viewport) ||
    !validCompatibilityProfileOverride(adapter.compatibilityProfile) ||
    adapter.scalingMode !== undefined && !validScalingMode(adapter.scalingMode) ||
    source?.kind !== J2ME_CONTENT_SOURCE || !boundedText(source.name, 500) ||
    !validUrl(source.url, true) || !Number.isSafeInteger(source.sizeBytes) ||
    source.sizeBytes <= 0 || source.sizeBytes > maximumJarBytes || !validDigest(source.sha256) ||
    source.sha256.toLowerCase() !== config.contentDigest.toLowerCase()) {
    throw new Error("J2ME_RUNTIME_CONFIG_INVALID");
  }
}

export async function sha256Hex(value, cryptoObject = globalThis.crypto) {
  if (!cryptoObject?.subtle) throw new Error("J2ME_RUNTIME_UNAVAILABLE");
  const bytes = copyBytes(value);
  const digest = await cryptoObject.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mountJ2me(config, target, options, reportProgress, reportExitRequested) {
  const frameWindow = options.frameWindow ?? target?.ownerDocument?.defaultView;
  const document = target?.ownerDocument;
  if (!document || !frameWindow || document !== frameWindow.document || !browserSupported(frameWindow)) {
    throw new Error("J2ME_RUNTIME_UNAVAILABLE");
  }

  const restored = options.restorePayload == null
    ? null
    : decodeCheckpoint(options.restorePayload, config.contentDigest);
  const jarBytes = await fetchJar(config.source, frameWindow, reportProgress);
  const profile = resolveCompatibilityProfile(config.source, {
    ...config.adapter.compatibilityProfile,
    viewport: config.adapter.viewport
  });
  const initialScalingMode = config.adapter.scalingMode ?? "SHARP_FIT";
  const surface = createSurface(document, frameWindow, config.adapter.viewport, initialScalingMode);
  target.replaceChildren(surface.root);
  const runtimeBaseUrl = new URL(normalizedBase(config.adapter.runtimeBaseUrl), document.baseURI);
  const previousMediaTranscode = frameWindow.__j2meMediaTranscode;
  const previousAudioProfile = frameWindow.__j2meAudioProfile;
  const mediaTranscoder = profile.audio.transcodeFallback
    ? createAudioTranscoder(runtimeBaseUrl, frameWindow)
    : null;
  const mediaTranscode = mediaTranscoder
    ? (bytes) => mediaTranscoder.transcode(bytes)
    : null;
  frameWindow.__j2meMediaTranscode = mediaTranscode;
  frameWindow.__j2meAudioProfile = { gain: profile.audio.gain, masterGain: 1 };
  const moduleOptions = {};
  const initialized = deferred();
  let module = null;
  let exited = false;
  let paused = false;
  let mirrorFrame = 0;
  let frameCount = 0;
  let viewMode = "LCD";
  let viewport = { ...config.adapter.viewport };
  let scalingMode = initialScalingMode;
  let exitReported = false;
  const hostBridgeReady = deferred();
  const pressedGamepadKeys = new Set();
  const pressedVirtualKeys = new Set();
  let inputProbe = null;
  let gcProbe = null;

  const diagnostic = (message) => options.onDiagnostic?.({ runtime: "j2me", message: String(message) });
  const reportCoreOutput = (message, error = false) => {
    const nextInputProbe = consumeInputProbe(message, inputProbe);
    if (nextInputProbe !== inputProbe) {
      inputProbe = nextInputProbe;
      return;
    }
    const nextGcProbe = consumeGcProbe(message, gcProbe);
    if (nextGcProbe !== gcProbe) {
      gcProbe = nextGcProbe;
      return;
    }
    diagnostic(`${error ? "[error] " : ""}${message}`);
    if (/HOST_BRIDGE_READY/u.test(String(message))) hostBridgeReady.resolve();
    if (/HOST_BRIDGE_FAILED/u.test(String(message))) hostBridgeReady.reject(new Error("J2ME_HOST_BRIDGE_UNAVAILABLE"));
    if (!exitReported && /MIDLET_EXIT_REQUESTED|MIDlet sent Destroyed Notification|APP TERMINATED!/u.test(String(message))) {
      exitReported = true;
      reportExitRequested();
    }
  };

  Object.assign(moduleOptions, {
    arguments: [
      "-Xmx128M",
      "-bootclasspath", "/lib/minijvm_rt.jar",
      "-cp", "/lib/glfw_gui.jar:/lib/xgui.jar:/lib/webj2me.jar",
      "org.j2me.web.WebLauncher"
    ],
    canvas: surface.source,
    locateFile(path) { return new URL(path, runtimeBaseUrl).href; },
    preRun: [() => prepareFileSystem(
      moduleOptions,
      jarBytes,
      profile,
      config.adapter.storage,
      restored,
      reportProgress,
      diagnostic,
      (error) => initialized.reject(stableJ2meError(error))
    )],
    print(message) { reportCoreOutput(message, false); },
    printErr(message) { reportCoreOutput(message, true); },
    setStatus(message) {
      if (!message) return;
      const progress = /Downloading data\.\.\. \((\d+)\/(\d+)\)/u.exec(message);
      if (progress) {
        reportProgress({
          phase: "RUNTIME_ASSET",
          loadedBytes: Number(progress[1]),
          totalBytes: Number(progress[2])
        });
      } else diagnostic(message);
    },
    onRuntimeInitialized() { initialized.resolve(); },
    onAbort(reason) { initialized.reject(stableJ2meError(reason)); }
  });

  const pointerHandlers = installPointerForwarding(surface, frameWindow, () => {
    surface.source.focus({ preventScroll: true });
    resumeRuntimeAudio(frameWindow);
  });
  const audioActivation = installAudioActivation({
    frameWindow,
    targets: [surface.source, surface.display]
  });
  applyViewMode(surface, viewMode);

  try {
    const createModule = options.moduleFactory ?? await loadModuleFactory(runtimeBaseUrl);
    module = await createModule(moduleOptions);
    await initialized.promise;
    await withTimeout(frameWindow, hostBridgeReady.promise, 60000, "J2ME_HOST_BRIDGE_UNAVAILABLE");
    surface.source.focus({ preventScroll: true });
    const mirror = () => {
      if (exited) return;
      if (!paused) {
        if (viewMode === "LCD") drawLcd(surface, viewport);
        updateGamepad(frameWindow, surface.source, pressedGamepadKeys, profile);
        frameCount += 1;
        if (frameCount % 30 === 0) resumeRuntimeAudio(frameWindow);
      }
      mirrorFrame = frameWindow.requestAnimationFrame(mirror);
    };
    mirrorFrame = frameWindow.requestAnimationFrame(mirror);
    resumeRuntimeAudio(frameWindow);
  } catch (error) {
    cleanup();
    throw stableJ2meError(error);
  }

  async function flushStorage() {
    if (config.adapter.storage !== "BROWSER" || !module?.FS?.filesystems?.IDBFS) return;
    await syncFileSystem(module.FS, false);
  }

  function cleanup() {
    if (exited) return;
    exited = true;
    if (mirrorFrame) frameWindow.cancelAnimationFrame(mirrorFrame);
    releaseKeys(frameWindow, surface.source, pressedGamepadKeys, profile);
    releaseKeys(frameWindow, surface.source, pressedVirtualKeys, profile);
    audioActivation.remove();
    mediaTranscoder?.close();
    if (frameWindow.__j2meMediaTranscode === mediaTranscode) {
      if (previousMediaTranscode === undefined) delete frameWindow.__j2meMediaTranscode;
      else frameWindow.__j2meMediaTranscode = previousMediaTranscode;
    }
    if (frameWindow.__j2meAudioProfile?.gain === profile.audio.gain) {
      if (previousAudioProfile === undefined) delete frameWindow.__j2meAudioProfile;
      else frameWindow.__j2meAudioProfile = previousAudioProfile;
    }
    pointerHandlers.remove();
    surface.resizeObserver?.disconnect();
    try { module?.pauseMainLoop?.(); } catch { /* The frame may already be tearing down. */ }
    pauseAudio(frameWindow);
    target.replaceChildren();
  }

  return {
    checkpoint: async () => {
      if (exited) throw new Error("J2ME_RUNTIME_INVALID_STATE");
      await flushStorage();
      const files = readRmsFiles(module.FS);
      if (!files.length) throw new Error("J2ME_CHECKPOINT_UNAVAILABLE");
      return { bytes: encodeCheckpoint(config.contentDigest, files), format: CHECKPOINT_FORMAT };
    },
    exit: async () => {
      if (exited) return;
      await flushStorage().catch(() => undefined);
      cleanup();
    },
    getCanvas: () => surface.display,
    getCheckpointAvailability: () => {
      if (exited || !module?.FS) return { available: false, blocker: "NOT_READY" };
      try {
        const files = readRmsFiles(module.FS);
        if (!files.length) return { available: false, blocker: "SAVE_DISABLED" };
        const bytes = files.reduce((total, file) =>
          total + file.bytes.byteLength + new TextEncoder().encode(file.path).byteLength + 6, 44);
        return bytes <= MAX_CHECKPOINT_BYTES
          ? { available: true, blocker: null }
          : { available: false, blocker: "UNSUPPORTED" };
      } catch {
        return { available: false, blocker: "BUSY" };
      }
    },
    getFrameCount: () => frameCount,
    getScalingMode: () => scalingMode,
    getValidationProbe: (kind) => {
      if (kind === INPUT_PROBE_KIND) return inputProbe;
      if (kind === GC_PROBE_KIND) return gcProbe;
      if (kind === MEDIA_PROBE_KIND) return mediaProbe(frameWindow, mediaTranscoder);
      return null;
    },
    pause: async () => {
      if (exited || paused) throw new Error("J2ME_RUNTIME_INVALID_STATE");
      paused = true;
      releaseKeys(frameWindow, surface.source, pressedGamepadKeys, profile);
      releaseKeys(frameWindow, surface.source, pressedVirtualKeys, profile);
      module.pauseMainLoop?.();
      pauseAudio(frameWindow);
    },
    resume: async () => {
      if (exited || !paused) throw new Error("J2ME_RUNTIME_INVALID_STATE");
      module.resumeMainLoop?.();
      paused = false;
      resumeRuntimeAudio(frameWindow);
      surface.source.focus({ preventScroll: true });
    },
    screenshot: () => canvasBlob(surface.display),
    setVolume: (value) => {
      frameWindow.__j2meAudioProfile.masterGain = value;
      const audio = frameWindow.__j2meWebAudio;
      if (!audio?.items) return;
      for (const item of audio.items.values()) {
        item.masterGain = value;
        if (item.gain) item.gain.gain.value = item.volume * item.profileGain * value;
      }
    },
    setScalingMode: (mode) => {
      if (!validScalingMode(mode)) throw new Error("J2ME_SCALING_MODE_INVALID");
      scalingMode = mode;
      resizeDisplay(surface, viewport, scalingMode);
      surface.source.focus({ preventScroll: true });
    },
    setInput: (action, pressed) => {
      if (!VIRTUAL_KEY_ACTIONS.includes(action) || typeof pressed !== "boolean") {
        throw new Error("J2ME_INPUT_INVALID");
      }
      const alreadyPressed = pressedVirtualKeys.has(action);
      if (pressed === alreadyPressed) return;
      dispatchAction(frameWindow, surface.source, action, pressed, profile);
      if (pressed) pressedVirtualKeys.add(action);
      else pressedVirtualKeys.delete(action);
    },
    setViewMode: (mode) => {
      viewMode = mode;
      applyViewMode(surface, viewMode);
      surface.source.focus({ preventScroll: true });
    },
    setViewport: (value) => {
      if (!validViewport(value)) throw new Error("J2ME_VIEWPORT_INVALID");
      viewport = { width: value.width, height: value.height };
      resizeDisplay(surface, viewport, scalingMode);
    },
    unlockAudio: () => resumeRuntimeAudio(frameWindow)
  };
}

async function loadModuleFactory(runtimeBaseUrl) {
  const imported = await import(new URL("runtime.js", runtimeBaseUrl).href);
  if (typeof imported.default !== "function") throw new Error("J2ME_RUNTIME_ASSET_INVALID");
  return imported.default;
}

async function fetchJar(source, frameWindow, reportProgress) {
  reportProgress({ phase: "PROJECT_CONTENT", loadedBytes: 0, totalBytes: source.sizeBytes });
  let response;
  try { response = await frameWindow.fetch(source.url); }
  catch { throw new Error("J2ME_CONTENT_FETCH_FAILED"); }
  if (!response.ok) throw new Error("J2ME_CONTENT_FETCH_FAILED");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(declaredLength) && declaredLength > 0 && declaredLength !== source.sizeBytes) {
    throw new Error("J2ME_CONTENT_SIZE_MISMATCH");
  }

  const chunks = [];
  let loaded = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > source.sizeBytes || loaded > maximumJarBytes) throw new Error("J2ME_CONTENT_SIZE_MISMATCH");
      chunks.push(value);
      reportProgress({ phase: "PROJECT_CONTENT", loadedBytes: loaded, totalBytes: source.sizeBytes });
    }
  } else {
    const value = new Uint8Array(await response.arrayBuffer());
    chunks.push(value);
    loaded = value.byteLength;
    reportProgress({ phase: "PROJECT_CONTENT", loadedBytes: loaded, totalBytes: source.sizeBytes });
  }
  if (loaded !== source.sizeBytes) throw new Error("J2ME_CONTENT_SIZE_MISMATCH");

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!validJar(bytes)) throw new Error("J2ME_CONTENT_INVALID");
  if (await sha256Hex(bytes, frameWindow.crypto) !== source.sha256.toLowerCase()) {
    throw new Error("J2ME_CONTENT_DIGEST_MISMATCH");
  }
  return bytes;
}

function prepareFileSystem(moduleOptions, jarBytes, profile, storage, restored, reportProgress, diagnostic, reportFailure) {
  const fs = moduleOptions.FS;
  if (!fs) throw new Error("J2ME_RUNTIME_FILESYSTEM_UNAVAILABLE");
  if (!fs.analyzePath(persistenceRoot).exists) fs.mkdirTree(persistenceRoot);
  const finish = () => {
    fs.writeFile("/game.jar", jarBytes);
    fs.writeFile("/j2me-web-profile.properties", new TextEncoder().encode(encodeCoreProfile(profile)));
    diagnostic(`compatibility profile ${profile.id} (${profile.viewport.width}x${profile.viewport.height}, ${profile.phone})`);
    diagnostic(`game mounted at /game.jar (${jarBytes.byteLength} bytes)`);
  };
  const applyRestore = () => {
    if (!restored) return;
    reportProgress({ phase: "RESTORE", loadedBytes: 0, totalBytes: restored.files.length });
    clearDirectory(fs, persistenceRoot);
    restored.files.forEach((file, index) => {
      const path = `${persistenceRoot}/${file.path}`;
      fs.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      fs.writeFile(path, file.bytes);
      reportProgress({ phase: "RESTORE", loadedBytes: index + 1, totalBytes: restored.files.length });
    });
  };

  const idbfs = fs.filesystems?.IDBFS;
  if (storage !== "BROWSER" || !idbfs) {
    if (storage === "BROWSER") diagnostic("IDBFS unavailable; using session-only RMS storage");
    applyRestore();
    finish();
    return;
  }

  fs.mount(idbfs, { autoPersist: true }, persistenceRoot);
  moduleOptions.addRunDependency("j2me-rms-idbfs");
  fs.syncfs(true, (loadError) => {
    if (loadError) diagnostic(`IDBFS restore failed: ${loadError}`);
    try { applyRestore(); }
    catch (error) {
      reportFailure(error);
      moduleOptions.removeRunDependency("j2me-rms-idbfs");
      return;
    }
    const complete = (saveError) => {
      if (saveError) diagnostic(`IDBFS checkpoint import failed: ${saveError}`);
      finish();
      moduleOptions.removeRunDependency("j2me-rms-idbfs");
    };
    if (restored) fs.syncfs(false, complete);
    else complete(null);
  });
}

function createSurface(document, frameWindow, viewport, scalingMode) {
  const root = document.createElement("div");
  const source = document.createElement("canvas");
  const display = document.createElement("canvas");
  const staging = document.createElement("canvas");
  root.dataset.j2meRuntimeSurface = "";
  source.className = "j2me-runtime-source";
  display.className = "j2me-runtime-display";
  source.tabIndex = 0;
  display.tabIndex = -1;
  display.setAttribute("aria-label", "J2ME game");
  Object.assign(root.style, {
    alignItems: "center", display: "flex", height: "100%", justifyContent: "center",
    minHeight: "0", minWidth: "0", overflow: "hidden", position: "relative", width: "100%"
  });
  Object.assign(source.style, {
    background: "#000", display: "block", height: "auto", maxHeight: "100%", maxWidth: "100%",
    outline: "none", width: "100%"
  });
  Object.assign(display.style, {
    background: "#000", display: "block", imageRendering: "pixelated",
    maxHeight: "100%", maxWidth: "100%", outline: "none", touchAction: "none"
  });
  const surface = { root, source, display, staging, resizeObserver: null, logicalViewport: null };
  resizeDisplay(surface, viewport, scalingMode);
  root.append(source, display);
  if (typeof frameWindow.ResizeObserver === "function") {
    surface.resizeObserver = new frameWindow.ResizeObserver(() =>
      updatePresentation(surface, surface.logicalViewport, surface.scalingMode));
    surface.resizeObserver.observe(root);
  }
  return surface;
}

function resizeDisplay(surface, viewport, scalingMode) {
  const factor = scalingMode === "SCALE2X" ? 2 : 1;
  surface.logicalViewport = { ...viewport };
  surface.scalingMode = scalingMode;
  surface.display.width = viewport.width * factor;
  surface.display.height = viewport.height * factor;
  surface.staging.width = viewport.width;
  surface.staging.height = viewport.height;
  surface.scaledPixels = scalingMode === "SCALE2X"
    ? new Uint32Array(viewport.width * viewport.height * 4)
    : null;
  surface.scaledImage = null;
  surface.display.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  const context = surface.display.getContext("2d", { alpha: false });
  if (context) context.imageSmoothingEnabled = false;
  updatePresentation(surface, viewport, scalingMode);
}

function updatePresentation(surface, viewport, scalingMode) {
  const availableWidth = surface.root.clientWidth;
  const availableHeight = surface.root.clientHeight;
  if (!availableWidth || !availableHeight) {
    surface.display.style.width = "100%";
    surface.display.style.height = "100%";
    return;
  }
  const size = computePresentationSize(viewport, availableWidth, availableHeight, scalingMode);
  surface.display.style.width = `${size.width}px`;
  surface.display.style.height = `${size.height}px`;
  surface.display.style.imageRendering = scalingMode === "SCALE2X" ? "auto" : "pixelated";
}

function applyViewMode(surface, mode) {
  const lcd = mode === "LCD";
  surface.display.style.display = lcd ? "block" : "none";
  surface.source.style.display = lcd ? "block" : "block";
  surface.source.style.position = lcd ? "absolute" : "relative";
  surface.source.style.opacity = lcd ? "0" : "1";
  surface.source.style.pointerEvents = lcd ? "none" : "auto";
}

function drawLcd(surface, viewport) {
  if (!surface.source.width || !surface.source.height) return;
  const context = surface.display.getContext("2d", { alpha: false });
  if (!context) return;
  try {
    if (surface.scalingMode !== "SCALE2X") {
      context.drawImage(surface.source, 2, 32, viewport.width, viewport.height,
        0, 0, surface.display.width, surface.display.height);
      return;
    }
    const stagingContext = surface.staging.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!stagingContext) return;
    stagingContext.drawImage(surface.source, 2, 32, viewport.width, viewport.height,
      0, 0, viewport.width, viewport.height);
    const input = stagingContext.getImageData(0, 0, viewport.width, viewport.height);
    scale2xPixels(new Uint32Array(input.data.buffer), viewport.width, viewport.height, surface.scaledPixels);
    surface.scaledImage ??= context.createImageData(viewport.width * 2, viewport.height * 2);
    new Uint32Array(surface.scaledImage.data.buffer).set(surface.scaledPixels);
    context.putImageData(surface.scaledImage, 0, 0);
  } catch { /* The WebGL surface may be unavailable during a resize. */ }
}

function installPointerForwarding(surface, frameWindow, activate) {
  const forward = (event) => {
    if (surface.display.style.display === "none") return;
    event.preventDefault();
    if (event.type === "pointerdown") surface.display.setPointerCapture?.(event.pointerId);
    const output = surface.display.getBoundingClientRect();
    const source = surface.source.getBoundingClientRect();
    const x = 2 + (event.clientX - output.left) / Math.max(1, output.width) * surface.logicalViewport.width;
    const y = 32 + (event.clientY - output.top) / Math.max(1, output.height) * surface.logicalViewport.height;
    const type = event.type === "pointerdown" ? "mousedown" :
      event.type === "pointerup" || event.type === "pointercancel" ? "mouseup" : "mousemove";
    surface.source.dispatchEvent(new frameWindow.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: source.left + x / Math.max(1, surface.source.width) * source.width,
      clientY: source.top + y / Math.max(1, surface.source.height) * source.height,
      button: event.button,
      buttons: event.buttons
    }));
    activate();
  };
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"];
  for (const type of types) surface.display.addEventListener(type, forward);
  return { remove: () => { for (const type of types) surface.display.removeEventListener(type, forward); } };
}

function updateGamepad(frameWindow, canvas, pressed, profile = null) {
  if (typeof frameWindow.navigator.getGamepads !== "function") return;
  const pad = Array.from(frameWindow.navigator.getGamepads()).find((value) => value?.connected && value.mapping === "standard");
  const desired = new Set();
  if (pad) {
    const button = (index) => Number(pad.buttons[index]?.value ?? 0) >= 0.5;
    const axisX = Number(pad.axes[0] ?? 0);
    const axisY = Number(pad.axes[1] ?? 0);
    if (button(12) || axisY <= -0.55) desired.add("UP");
    if (button(13) || axisY >= 0.55) desired.add("DOWN");
    if (button(14) || axisX <= -0.55) desired.add("LEFT");
    if (button(15) || axisX >= 0.55) desired.add("RIGHT");
    if (button(0)) desired.add("FIRE");
    if (button(1) || button(8)) desired.add("SOFT_RIGHT");
    if (button(2) || button(9)) desired.add("SOFT_LEFT");
  }
  for (const code of pressed) {
    if (!desired.has(code)) {
      dispatchAction(frameWindow, canvas, code, false, profile);
      pressed.delete(code);
    }
  }
  for (const code of desired) {
    if (!pressed.has(code)) {
      dispatchAction(frameWindow, canvas, code, true, profile);
      pressed.add(code);
    }
  }
}

function releaseKeys(frameWindow, canvas, pressed, profile = null) {
  for (const action of pressed) dispatchAction(frameWindow, canvas, action, false, profile);
  pressed.clear();
}

function dispatchAction(frameWindow, canvas, action, down, profile) {
  const key = keyDescriptor(action, profile);
  if (!key) return;
  const event = new frameWindow.KeyboardEvent(down ? "keydown" : "keyup", {
    bubbles: true, cancelable: true, code: key.code, key: key.key
  });
  Object.defineProperties(event, {
    keyCode: { value: key.keyCode },
    which: { value: key.keyCode }
  });
  canvas.dispatchEvent(event);
}

function readRmsFiles(fs) {
  if (!fs.analyzePath(persistenceRoot).exists) return [];
  const files = [];
  const visit = (absolute, relative) => {
    const names = fs.readdir(absolute).filter((name) => name !== "." && name !== "..").sort();
    for (const name of names) {
      const child = `${absolute}/${name}`;
      const path = relative ? `${relative}/${name}` : name;
      const stats = fs.stat(child);
      if (fs.isDir(stats.mode)) visit(child, path);
      else files.push({ path, bytes: fs.readFile(child) });
    }
  };
  visit(persistenceRoot, "");
  return files;
}

function clearDirectory(fs, root) {
  if (!fs.analyzePath(root).exists) return;
  for (const name of fs.readdir(root)) {
    if (name === "." || name === "..") continue;
    const path = `${root}/${name}`;
    const stats = fs.stat(path);
    if (fs.isDir(stats.mode)) {
      clearDirectory(fs, path);
      fs.rmdir(path);
    } else fs.unlink(path);
  }
}

function syncFileSystem(fs, populate) {
  return new Promise((resolve, reject) => fs.syncfs(populate, (error) => error ? reject(error) : resolve()));
}

function withTimeout(frameWindow, promise, milliseconds, code) {
  return new Promise((resolve, reject) => {
    const timer = frameWindow.setTimeout(() => reject(new Error(code)), milliseconds);
    promise.then(
      (value) => { frameWindow.clearTimeout(timer); resolve(value); },
      (error) => { frameWindow.clearTimeout(timer); reject(error); }
    );
  });
}

function pauseAudio(frameWindow) {
  suspendRuntimeAudio(frameWindow);
}

function mediaProbe(frameWindow, mediaTranscoder) {
  const backendStats = frameWindow.__j2meWebAudio?.stats ?? {};
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    kind: MEDIA_PROBE_KIND,
    schemaVersion: 1,
    backend: {
      creates: count(backendStats.creates),
      decodeFailures: count(backendStats.decodeFailures),
      transcodeBegins: count(backendStats.transcodeBegins),
      transcodeFailures: count(backendStats.transcodeFailures),
      transcodeSuccesses: count(backendStats.transcodeSuccesses)
    },
    transcoder: mediaTranscoder?.getStats() ?? { failures: 0, requests: 0, successes: 0 }
  };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob?.size ? resolve(blob) : reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE")),
    "image/png"
  ));
}

function validJar(bytes) {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 && bytes[3] === 0x04 || bytes[2] === 0x05 && bytes[3] === 0x06 ||
      bytes[2] === 0x07 && bytes[3] === 0x08);
}

function validateRuntimeOptions(options) {
  if (!options || typeof options !== "object" ||
    options.restorePayload != null && !(options.restorePayload instanceof Uint8Array) ||
    options.signal != null && !(options.signal instanceof AbortSignal) ||
    options.onDiagnostic != null && typeof options.onDiagnostic !== "function" ||
    options.moduleFactory != null && typeof options.moduleFactory !== "function") {
    throw new Error("J2ME_RUNTIME_OPTIONS_INVALID");
  }
}

function browserSupported(frameWindow) {
  return frameWindow.crossOriginIsolated === true && typeof frameWindow.SharedArrayBuffer === "function" &&
    typeof frameWindow.WebAssembly === "object" && typeof frameWindow.requestAnimationFrame === "function" &&
    typeof frameWindow.fetch === "function";
}

function validStorage(value) { return value === "BROWSER" || value === "HOST"; }
function validViewport(value) {
  return value && Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height) &&
    value.width > 0 && value.width <= 240 && value.height > 0 && value.height <= 320;
}
function validDigest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value); }
function boundedText(value, maximum) { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function validUrl(value, allowBlob = false) {
  try {
    const protocols = allowBlob ? ["http:", "https:", "blob:"] : ["http:", "https:"];
    return protocols.includes(new URL(value, globalThis.location?.origin ?? "https://runtime.invalid").protocol);
  } catch { return false; }
}
function normalizedBase(value) { return value.endsWith("/") ? value : `${value}/`; }
function copyBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new Error("J2ME_RUNTIME_CONFIG_INVALID");
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
function stableJ2meError(error) {
  if (error instanceof Error && /^(?:J2ME|RUNTIME|CHECKPOINT|PLAYER)_[A-Z0-9_]+$/u.test(error.message)) return error;
  return new Error("J2ME_RUNTIME_FAILED");
}
