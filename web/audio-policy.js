export function resumeRuntimeAudio(frameWindow) {
  const devices = frameWindow?.miniaudio?.devices || [];
  let found = false;
  for (const device of devices) {
    const context = device?.webaudio;
    if (!context) continue;
    found = true;
    if (context.state !== "running") void context.resume().catch(() => undefined);
  }
  const browserContext = frameWindow?.__j2meWebAudio?.context;
  if (browserContext) {
    found = true;
    if (browserContext.state !== "running") void browserContext.resume().catch(() => undefined);
  }
  return found;
}

export function suspendRuntimeAudio(frameWindow) {
  const contexts = new Set([
    ...(frameWindow?.miniaudio?.devices || []).map((device) => device?.webaudio),
    frameWindow?.__j2meWebAudio?.context
  ]);
  let found = false;
  for (const context of contexts) {
    if (!context) continue;
    found = true;
    if (context.state === "running") void context.suspend().catch(() => undefined);
  }
  return found;
}

export async function closeRuntimeAudio(frameWindow) {
  const audio = frameWindow?.__j2meWebAudio;
  const contexts = new Set([
    ...(frameWindow?.miniaudio?.devices || []).map((device) => device?.webaudio), audio?.context
  ]);
  for (const item of audio?.items?.values() ?? []) {
    item.closed = true;
    item.playRequested = false;
    if (item.source) {
      item.source.onended = null;
      try { item.source.stop(); item.source.disconnect(); } catch { /* Already stopped. */ }
    }
    try { item.gain?.disconnect(); } catch { /* Already disconnected. */ }
  }
  audio?.items?.clear();
  if (frameWindow.__j2meWebAudio === audio) delete frameWindow.__j2meWebAudio;
  await Promise.allSettled([...contexts].filter((context) => context && context.state !== "closed")
    .map((context) => context.close()));
}

export function installAudioActivation({ frameWindow, targets, isActive = () => true }) {
  if (!Array.isArray(targets) || targets.some((target) =>
    !target?.addEventListener || !target?.removeEventListener)) {
    throw new TypeError("Invalid audio activation target");
  }
  const activate = () => { if (isActive()) resumeRuntimeAudio(frameWindow); };
  for (const target of targets) {
    target.addEventListener("keydown", activate, true);
    target.addEventListener("pointerdown", activate, true);
  }
  return {
    remove() {
      for (const target of targets) {
        target.removeEventListener("keydown", activate, true);
        target.removeEventListener("pointerdown", activate, true);
      }
    }
  };
}
