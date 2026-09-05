export const VIRTUAL_KEY_ACTIONS = Object.freeze([
  "UP", "DOWN", "LEFT", "RIGHT", "FIRE", "SOFT_LEFT", "SOFT_RIGHT",
  "DIGIT_0", "DIGIT_1", "DIGIT_2", "DIGIT_3", "DIGIT_4", "DIGIT_5",
  "DIGIT_6", "DIGIT_7", "DIGIT_8", "DIGIT_9", "STAR", "POUND"
]);

const descriptors = Object.freeze({
  UP: { code: "ArrowUp", key: "ArrowUp", keyCode: 38 },
  DOWN: { code: "ArrowDown", key: "ArrowDown", keyCode: 40 },
  LEFT: { code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 },
  RIGHT: { code: "ArrowRight", key: "ArrowRight", keyCode: 39 },
  FIRE: { code: "Enter", key: "Enter", keyCode: 13 },
  SOFT_LEFT: { code: "KeyQ", key: "q", keyCode: 81 },
  SOFT_RIGHT: { code: "KeyE", key: "e", keyCode: 69 },
  STAR: { code: "NumpadMultiply", key: "*", keyCode: 106 },
  POUND: { code: "NumpadDivide", key: "#", keyCode: 111 },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [
    `DIGIT_${digit}`,
    { code: `Digit${digit}`, key: String(digit), keyCode: 48 + digit }
  ]))
});

export function keyDescriptor(action, profile) {
  if (!VIRTUAL_KEY_ACTIONS.includes(action)) return null;
  if (profile?.input?.softKeySwap && action === "SOFT_LEFT") return { ...descriptors.SOFT_RIGHT };
  if (profile?.input?.softKeySwap && action === "SOFT_RIGHT") return { ...descriptors.SOFT_LEFT };
  return { ...descriptors[action] };
}

export class VirtualKeyState {
  constructor(options) {
    if (typeof options?.dispatch !== "function") throw new TypeError("J2ME_VIRTUAL_KEYPAD_INVALID");
    this.dispatch = options.dispatch;
    this.repeatDelayMs = options.repeatDelayMs;
    this.repeatIntervalMs = options.repeatIntervalMs;
    this.setTimeout = options.setTimeout;
    this.clearTimeout = options.clearTimeout;
    this.setInterval = options.setInterval;
    this.clearInterval = options.clearInterval;
    this.pointers = new Map();
    this.actions = new Map();
  }

  press(pointerId, action) {
    if (this.pointers.has(pointerId) || !VIRTUAL_KEY_ACTIONS.includes(action)) return;
    this.pointers.set(pointerId, action);
    let entry = this.actions.get(action);
    if (!entry) {
      entry = { count: 0, delay: null, interval: null };
      this.actions.set(action, entry);
    }
    entry.count += 1;
    if (entry.count !== 1) return;
    this.dispatch(action, true);
    entry.delay = this.setTimeout(() => {
      if (!this.actions.has(action)) return;
      this.dispatch(action, false);
      this.dispatch(action, true);
      entry.interval = this.setInterval(() => {
        if (!this.actions.has(action)) return;
        this.dispatch(action, false);
        this.dispatch(action, true);
      }, this.repeatIntervalMs);
    }, this.repeatDelayMs);
  }

  release(pointerId) {
    const action = this.pointers.get(pointerId);
    if (!action) return;
    this.pointers.delete(pointerId);
    const entry = this.actions.get(action);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    this.stopEntry(entry);
    this.actions.delete(action);
    this.dispatch(action, false);
  }

  releaseAll() {
    for (const [action, entry] of this.actions) {
      this.stopEntry(entry);
      this.dispatch(action, false);
    }
    this.actions.clear();
    this.pointers.clear();
  }

  stopEntry(entry) {
    if (entry.delay !== null) this.clearTimeout(entry.delay);
    if (entry.interval !== null) this.clearInterval(entry.interval);
  }
}

export function createVirtualKeypad(runtime, container, profile, options = {}) {
  const document = container?.ownerDocument;
  const frameWindow = document?.defaultView;
  if (!document || !frameWindow || typeof runtime?.setInput !== "function") {
    throw new TypeError("J2ME_VIRTUAL_KEYPAD_INVALID");
  }
  const root = document.createElement("div");
  root.className = "j2me-virtual-keypad";
  root.setAttribute("aria-label", "J2ME 触屏按键");
  const state = new VirtualKeyState({
    dispatch: (action, pressed) => {
      if (runtime.getState() === "RUNNING") runtime.setInput(action, pressed);
    },
    repeatDelayMs: profile.input.repeatDelayMs,
    repeatIntervalMs: profile.input.repeatIntervalMs,
    setTimeout: frameWindow.setTimeout.bind(frameWindow),
    clearTimeout: frameWindow.clearTimeout.bind(frameWindow),
    setInterval: frameWindow.setInterval.bind(frameWindow),
    clearInterval: frameWindow.clearInterval.bind(frameWindow)
  });

  const groups = [
    ["direction", [["UP", "↑"], ["LEFT", "←"], ["FIRE", "OK"], ["RIGHT", "→"], ["DOWN", "↓"]]],
    ["soft", [["SOFT_LEFT", "菜单"], ["SOFT_RIGHT", "返回"]]],
    ["number", [
      ["DIGIT_1", "1"], ["DIGIT_2", "2"], ["DIGIT_3", "3"],
      ["DIGIT_4", "4"], ["DIGIT_5", "5"], ["DIGIT_6", "6"],
      ["DIGIT_7", "7"], ["DIGIT_8", "8"], ["DIGIT_9", "9"],
      ["STAR", "*"], ["DIGIT_0", "0"], ["POUND", "#"]
    ]]
  ];
  for (const [name, keys] of groups) {
    const group = document.createElement("div");
    group.className = `j2me-keypad-${name}`;
    for (const [action, label] of keys) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.j2meAction = action;
      button.textContent = label;
      button.setAttribute("aria-label", action);
      group.append(button);
    }
    root.append(group);
  }

  const pointerDown = (event) => {
    if (runtime.getState() !== "RUNNING") return;
    const button = event.target.closest?.("[data-j2me-action]");
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    try { button.setPointerCapture?.(event.pointerId); } catch { /* Synthetic validation events are not active pointers. */ }
    button.dataset.pressed = "";
    state.press(event.pointerId, button.dataset.j2meAction);
  };
  const pointerUp = (event) => {
    const button = event.target.closest?.("[data-j2me-action]");
    if (button) delete button.dataset.pressed;
    state.release(event.pointerId);
  };
  const preventContextMenu = (event) => event.preventDefault();
  const releaseAll = () => {
    for (const button of root.querySelectorAll("[data-pressed]")) delete button.dataset.pressed;
    state.releaseAll();
  };
  root.addEventListener("pointerdown", pointerDown);
  root.addEventListener("pointerup", pointerUp);
  root.addEventListener("pointercancel", pointerUp);
  root.addEventListener("lostpointercapture", pointerUp);
  root.addEventListener("contextmenu", preventContextMenu);
  frameWindow.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", releaseAll);
  const unsubscribe = runtime.subscribe((event) => {
    if (event.type === "STATE_CHANGED" && event.state !== "RUNNING") releaseAll();
  });
  container.append(root);

  const initiallyVisible = options.visible ?? frameWindow.matchMedia?.("(pointer: coarse)").matches ?? false;
  root.hidden = !initiallyVisible;
  return {
    element: root,
    isVisible: () => !root.hidden,
    setVisible(visible) {
      if (!visible) releaseAll();
      root.hidden = !visible;
    },
    remove() {
      releaseAll();
      unsubscribe();
      frameWindow.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", releaseAll);
      root.remove();
    }
  };
}
