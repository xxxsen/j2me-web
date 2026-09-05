// Loaded as an external module in the host's frame, including under a strict CSP.
const key = new URL(import.meta.url).searchParams.get("bridge");
const bridge = globalThis[key];
if (bridge) {
  try {
    const { default: factory } = await import("./runtime.js");
    if (typeof factory !== "function") throw new Error("J2ME_RUNTIME_ASSET_INVALID");
    bridge.resolve(factory);
  } catch (error) { bridge.reject(error); }
}
