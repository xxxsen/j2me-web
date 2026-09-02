const unavailable = Object.freeze({ available: false, blocker: "NOT_READY" });

export class GameRuntimeController {
  constructor(mountAdapter, capabilities, abortSignal = null) {
    this.mountAdapter = mountAdapter;
    this.capabilities = capabilities;
    this.abortSignal = abortSignal;
    this.listeners = new Set();
    this.adapter = null;
    this.state = "CREATED";
    this.mountCalled = false;
    this.exitPromise = null;
    this.operationTail = Promise.resolve();
    this.lastAvailability = unavailable;
    this.availabilityTimer = null;
    this.exitRequested = false;
    this.abort = () => { void this.exit(); };
    abortSignal?.addEventListener("abort", this.abort, { once: true });
  }

  async mount(target) {
    if (this.mountCalled || this.state !== "CREATED") throw new Error("RUNTIME_INVALID_STATE");
    this.mountCalled = true;
    if (this.abortSignal?.aborted) {
      await this.exit();
      throw new DOMException("Aborted", "AbortError");
    }
    this.transition("LOADING");
    try {
      const adapter = await this.mountAdapter(target, this.reportProgress, this.reportExitRequested);
      if (this.abortSignal?.aborted || exitHasStarted(this.state)) {
        await adapter.exit();
        throw new DOMException("Aborted", "AbortError");
      }
      this.adapter = adapter;
      this.transition("RUNNING");
      this.refreshAvailability();
      this.startAvailabilityPolling();
      this.emit({ type: "READY" });
    } catch (error) {
      await this.fail(error);
      throw stableError(error);
    }
  }

  pause() { return this.enqueue(() => this.performPause()); }
  resume() { return this.enqueue(() => this.performResume()); }
  checkpoint() { return this.enqueue(() => this.performCheckpoint()); }

  async screenshot() {
    this.requireCapability("screenshot");
    this.requireActiveState();
    const screenshot = await this.requireAdapter().screenshot();
    if (!(screenshot instanceof Blob) || !screenshot.size) throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
    return screenshot;
  }

  async exit() {
    this.exitPromise ??= this.performExit();
    return this.exitPromise;
  }

  getState() { return this.state; }
  getCapabilities() { return this.capabilities; }

  getCheckpointAvailability() {
    if (this.state === "FAILED") return { available: false, blocker: "FAILED" };
    if ((this.state !== "RUNNING" && this.state !== "PAUSED") || !this.adapter) return unavailable;
    return this.refreshAvailability();
  }

  getCanvas() { return this.adapter?.getCanvas() ?? null; }

  getScalingMode() { return this.adapter?.getScalingMode?.() ?? null; }

  getFrameCount() {
    if (!this.capabilities.frameCounter || !this.adapter) return null;
    const value = this.adapter.getFrameCount();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  getValidationProbe(kind) {
    if (!this.capabilities.validationProbes.includes(kind) || !this.adapter) return null;
    const probe = this.adapter.getValidationProbe(kind);
    return probe?.kind === kind && Number.isSafeInteger(probe.schemaVersion) && probe.schemaVersion > 0
      ? structuredClone(probe)
      : null;
  }

  setVolume(value) {
    if (!this.capabilities.volume || !this.adapter?.setVolume) throw new Error("RUNTIME_OPERATION_UNSUPPORTED");
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("RUNTIME_VOLUME_INVALID");
    this.adapter.setVolume(value);
  }

  setInput(action, pressed) {
    this.requireCapability("virtualKeyInput");
    this.requireActiveState();
    if (!this.capabilities.virtualKeyActions?.includes(action) || typeof pressed !== "boolean") {
      throw new Error("J2ME_INPUT_INVALID");
    }
    this.requireAdapter().setInput(action, pressed);
  }

  unlockAudio() {
    this.requireActiveState();
    return this.requireAdapter().unlockAudio?.() ?? false;
  }

  setViewMode(mode) {
    this.requireActiveState();
    if (mode !== "LCD" && mode !== "EMULATOR") throw new Error("J2ME_VIEW_MODE_INVALID");
    this.requireAdapter().setViewMode?.(mode);
  }

  setScalingMode(mode) {
    this.requireActiveState();
    if (!this.capabilities.videoScalingModes?.includes(mode)) {
      throw new Error("J2ME_SCALING_MODE_INVALID");
    }
    this.requireAdapter().setScalingMode?.(mode);
  }

  setViewport(viewport) {
    this.requireActiveState();
    this.requireAdapter().setViewport?.(viewport);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  reportProgress = (progress) => {
    if (this.state !== "LOADING" || !validProgress(progress)) return;
    this.emit({ type: "LOAD_PROGRESS", ...progress });
  };

  reportExitRequested = () => {
    if (this.exitRequested || exitHasStarted(this.state) || this.state === "FAILED") return;
    this.exitRequested = true;
    this.emit({ type: "EXIT_REQUESTED" });
    void this.exit();
  };

  async performPause() {
    this.requireCapability("pause");
    this.requireState("RUNNING");
    await this.perform("RUNNING", "PAUSED", () => this.requireAdapter().pause());
  }

  async performResume() {
    this.requireCapability("pause");
    this.requireState("PAUSED");
    await this.perform("PAUSED", "RUNNING", () => this.requireAdapter().resume());
  }

  async performCheckpoint() {
    this.requireCapability("checkpoint");
    if (exitHasStarted(this.state)) throw new DOMException("Aborted", "AbortError");
    this.requireActiveState();
    if (!this.getCheckpointAvailability().available) throw new Error("CHECKPOINT_UNAVAILABLE");
    const previous = this.state;
    this.transition("CHECKPOINTING");
    try {
      const payload = await this.requireAdapter().checkpoint();
      if (!(payload?.bytes instanceof Uint8Array) || !payload.bytes.byteLength || !validCheckpointFormat(payload.format)) {
        throw new Error("CHECKPOINT_CREATE_FAILED");
      }
      this.assertOperationActive("CHECKPOINTING");
      this.transition(previous);
      this.refreshAvailability();
      return { bytes: payload.bytes.slice(), format: payload.format };
    } catch (error) {
      if (this.state === "CHECKPOINTING") {
        this.transition(previous);
        this.refreshAvailability();
      }
      throw stableError(error);
    }
  }

  enqueue(operation) {
    const pending = this.operationTail.then(operation);
    this.operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async perform(expected, next, operation) {
    try {
      await operation();
      this.assertOperationActive(expected);
      this.transition(next);
    } catch (error) {
      if (!exitHasStarted(this.state)) await this.fail(error);
      throw stableError(error);
    }
  }

  async performExit() {
    if (this.state === "EXITED") return;
    const failed = this.state === "FAILED";
    if (!failed) this.transition("EXITING");
    let exitError;
    this.stopAvailabilityPolling();
    try { await this.adapter?.exit(); } catch (error) { exitError = error; }
    this.adapter = null;
    this.abortSignal?.removeEventListener("abort", this.abort);
    if (!failed) this.transition("EXITED");
    this.listeners.clear();
    if (exitError) throw stableError(exitError);
  }

  async fail(error) {
    this.stopAvailabilityPolling();
    const adapter = this.adapter;
    this.adapter = null;
    if (this.state !== "FAILED" && this.state !== "EXITED") this.transition("FAILED");
    try { await adapter?.exit(); } catch { /* Preserve the original failure. */ }
    this.emit({ type: "FATAL_ERROR", code: stableError(error).message });
  }

  refreshAvailability() {
    const next = normalizedAvailability(this.requireAdapter().getCheckpointAvailability());
    if (next.available !== this.lastAvailability.available || next.blocker !== this.lastAvailability.blocker) {
      this.lastAvailability = next;
      this.emit({ type: "CHECKPOINT_AVAILABILITY_CHANGED", availability: next });
    }
    return next;
  }

  startAvailabilityPolling() {
    this.availabilityTimer = globalThis.setInterval(() => {
      if (this.state !== "RUNNING" && this.state !== "PAUSED") return;
      try { this.refreshAvailability(); }
      catch (error) { if (!exitHasStarted(this.state)) void this.fail(error); }
    }, 250);
  }

  stopAvailabilityPolling() {
    if (this.availabilityTimer !== null) globalThis.clearInterval(this.availabilityTimer);
    this.availabilityTimer = null;
  }

  requireAdapter() {
    if (!this.adapter) throw new Error("RUNTIME_INVALID_STATE");
    return this.adapter;
  }

  requireState(expected) {
    if (this.state !== expected) throw new Error("RUNTIME_INVALID_STATE");
  }

  requireActiveState() {
    if (this.state !== "RUNNING" && this.state !== "PAUSED") throw new Error("RUNTIME_INVALID_STATE");
  }

  requireCapability(capability) {
    if (!this.capabilities[capability]) throw new Error("RUNTIME_OPERATION_UNSUPPORTED");
  }

  assertOperationActive(expected) {
    if (this.state !== expected) throw new DOMException("Aborted", "AbortError");
  }

  transition(next) {
    if (!validTransition(this.state, next)) throw new Error("RUNTIME_INVALID_STATE");
    const previous = this.state;
    this.state = next;
    this.emit({ type: "STATE_CHANGED", previous, state: next });
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}

const transitions = {
  CREATED: ["LOADING", "EXITING"],
  LOADING: ["RUNNING", "EXITING"],
  RUNNING: ["PAUSED", "CHECKPOINTING", "EXITING"],
  PAUSED: ["RUNNING", "CHECKPOINTING", "EXITING"],
  CHECKPOINTING: ["RUNNING", "PAUSED", "EXITING"],
  EXITING: ["EXITED"],
  EXITED: [],
  FAILED: []
};

function validTransition(previous, next) {
  return next === "FAILED" ? previous !== "FAILED" && previous !== "EXITED" : transitions[previous].includes(next);
}

function exitHasStarted(state) { return state === "EXITING" || state === "EXITED"; }
function validCheckpointFormat(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9.-]{0,63}$/u.test(value); }
function validProgress(value) {
  return Number.isSafeInteger(value?.loadedBytes) && value.loadedBytes >= 0 &&
    (value.totalBytes === null || Number.isSafeInteger(value.totalBytes) && value.totalBytes >= value.loadedBytes);
}
function normalizedAvailability(value) {
  if (value?.available === true && value.blocker === null) return value;
  if (value?.available === false && typeof value.blocker === "string") return value;
  return { available: false, blocker: "FAILED" };
}
function stableError(error) {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (error instanceof Error && /^(?:RUNTIME|CHECKPOINT|PLAYER|J2ME)_[A-Z0-9_]+$/u.test(error.message)) return error;
  return new Error("RUNTIME_FAILED");
}
