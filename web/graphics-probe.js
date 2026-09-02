export const GRAPHICS_PROBE_KIND = "J2ME_3D_V1";

const marker = /^\[J2ME_3D_V1\] api=(M3G|MASCOT) backend=(WEBGL2|SOFTWARE) event=(created|frame|fallback) items=(\d+)(?: reason=([A-Za-z0-9_.-]+))?$/u;

export function consumeGraphicsProbe(message, previous) {
  const match = marker.exec(String(message));
  if (!match) return previous;
  const items = Number(match[4]);
  if (!Number.isSafeInteger(items) || items < 0) return previous;
  return {
    kind: GRAPHICS_PROBE_KIND,
    schemaVersion: 1,
    sequence: (previous?.sequence ?? 0) + 1,
    api: match[1],
    backend: match[2],
    event: match[3],
    items,
    reason: match[5] ?? null
  };
}
