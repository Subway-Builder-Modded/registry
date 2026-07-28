import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export const CANONICAL_HISTORY_CUTOFF_HOUR_UTC = 4;

export function toSnapshotDate(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "_");
}

export function toCanonicalHistoryCutoffIso(snapshotDate: string): string {
  const normalizedDate = snapshotDate.replaceAll("_", "-");
  return `${normalizedDate}T${String(CANONICAL_HISTORY_CUTOFF_HOUR_UTC).padStart(2, "0")}:00:00.000Z`;
}

export function getHistoryDir(repoRoot: string): string {
  return resolve(repoRoot, "history");
}

/** snapshot_YYYY_MM_DD.json file names in the history dir, in readdir order. */
export function listSnapshotFileNames(historyDir: string): string[] {
  return readdirSync(historyDir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name));
}

/**
 * Last item whose timestamp is at or before targetMs. Items must be in
 * ascending time order; items with a null timestamp are skipped, and scanning
 * stops at the first item past the target.
 */
export function findLastAtOrBefore<T>(
  items: readonly T[],
  toTimeMs: (item: T) => number | null,
  targetMs: number,
): T | null {
  let selected: T | null = null;
  for (const item of items) {
    const timeMs = toTimeMs(item);
    if (timeMs === null) continue;
    if (timeMs <= targetMs) {
      selected = item;
    } else {
      break;
    }
  }
  return selected;
}
