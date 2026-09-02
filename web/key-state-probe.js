export const KEY_STATE_PROBE_KIND = "J2ME_KEY_STATE_V1";

const marker = /^\[j2me-web-key-state\] key=(-?\d+) action=(-?\d+) state=(\d+) pressed=([01])$/u;

export function consumeKeyStateProbe(message, previous) {
  const match = marker.exec(String(message));
  if (!match) return previous;
  const [keyCode, gameAction, state, pressed] = match.slice(1).map(Number);
  if (![keyCode, gameAction, state, pressed].every(Number.isSafeInteger) ||
      keyCode < -32768 || keyCode > 32767 || gameAction < -32768 || gameAction > 32767 ||
      state < 0 || state > 0x7fffffff) return previous;
  return {
    kind: KEY_STATE_PROBE_KIND,
    schemaVersion: 1,
    sequence: (previous?.sequence ?? 0) + 1,
    keyCode,
    gameAction,
    state,
    pressed: pressed === 1
  };
}
