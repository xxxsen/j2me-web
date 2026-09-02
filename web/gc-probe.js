export const GC_PROBE_KIND = "J2ME_GC_V1";

const marker = /^\[j2me-web-gc\] cycle=(\d+) before=(\d+) after=(\d+) reclaimed=(\d+) wait_ms=(\d+) stw_ms=(\d+)$/u;

export function consumeGcProbe(message, previous) {
  const match = marker.exec(String(message));
  if (!match) return previous;
  const [cycle, beforeBytes, afterBytes, reclaimedBytes, waitMs, stopWorldMs] = match
    .slice(1)
    .map(Number);
  if (![cycle, beforeBytes, afterBytes, reclaimedBytes, waitMs, stopWorldMs].every(Number.isSafeInteger) ||
    cycle <= 0 || beforeBytes < 0 || afterBytes < 0 || reclaimedBytes < 0 || waitMs < 0 || stopWorldMs < 0 ||
    afterBytes > beforeBytes || reclaimedBytes > beforeBytes) {
    return previous;
  }
  return {
    kind: GC_PROBE_KIND,
    schemaVersion: 1,
    sequence: (previous?.sequence ?? 0) + 1,
    cycle,
    beforeBytes,
    afterBytes,
    reclaimedBytes,
    waitMs,
    stopWorldMs
  };
}
