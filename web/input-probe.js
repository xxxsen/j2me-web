export const INPUT_PROBE_KIND = "J2ME_INPUT_V1";

const marker = /^\[j2me-web-input\] (-?\d+)$/u;

export function consumeInputProbe(message, previous) {
  const match = marker.exec(String(message));
  if (!match) return previous;
  const keyCode = Number(match[1]);
  if (!Number.isSafeInteger(keyCode) || keyCode < -32768 || keyCode > 32767) return previous;
  return {
    kind: INPUT_PROBE_KIND,
    keyCode,
    schemaVersion: 1,
    sequence: (previous?.sequence ?? 0) + 1
  };
}
