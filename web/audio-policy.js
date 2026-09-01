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

export function installAudioActivation({ frameWindow, targets }) {
  if (!Array.isArray(targets) || targets.some((target) =>
    !target?.addEventListener || !target?.removeEventListener)) {
    throw new TypeError("Invalid audio activation target");
  }
  const activate = () => resumeRuntimeAudio(frameWindow);
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
