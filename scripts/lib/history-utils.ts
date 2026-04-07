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
