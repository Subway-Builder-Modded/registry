import { join } from "node:path";
import { findLastAtOrBefore, listSnapshotFileNames } from "../history-utils.js";
import { isFiniteNumber, readJsonFile } from "../json-utils.js";
import { isTestListing } from "../test-listings.js";
import type { ListingKey, ListingTotals, SnapshotData, SnapshotEntry } from "./types.js";

export function parseSnapshotDate(fileName: string): Date | null {
  const match = fileName.match(/^snapshot_(\d{4})_(\d{2})_(\d{2})\.json$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function listSnapshots(historyDir: string): SnapshotEntry[] {
  return listSnapshotFileNames(historyDir)
    .map((file) => ({ file, date: parseSnapshotDate(file) }))
    .filter((entry): entry is SnapshotEntry => entry.date instanceof Date)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function toListingTotals(snapshot: SnapshotData): ListingTotals {
  const totals = new Map<ListingKey, number>();
  for (const listingType of ["maps", "mods"] as const) {
    // `downloads` is the canonical adjusted/non-attributed listing data in schema v2.
    const downloads = snapshot?.[listingType]?.downloads;
    if (!downloads || typeof downloads !== "object") continue;
    for (const [id, versions] of Object.entries(downloads)) {
      if (!versions || typeof versions !== "object") continue;
      let total = 0;
      for (const count of Object.values(versions)) {
        if (isFiniteNumber(count)) {
          total += count;
        }
      }
      totals.set(`${listingType}:${id}`, total);
    }
  }
  return totals;
}

export function toListingIdSet(
  snapshot: SnapshotData,
  repoRoot: string,
  listingType: "maps" | "mods",
): Set<string> {
  const ids = new Set<string>();
  const downloads = snapshot?.[listingType]?.downloads;
  if (!downloads || typeof downloads !== "object") return ids;
  for (const id of Object.keys(downloads)) {
    if (isTestListing(repoRoot, listingType, id)) continue;
    ids.add(id);
  }
  return ids;
}

export function buildListingIdsBySnapshot(
  snapshots: SnapshotEntry[],
  historyDir: string,
  repoRoot: string,
): Map<string, { maps: Set<string>; mods: Set<string> }> {
  const bySnapshot = new Map<string, { maps: Set<string>; mods: Set<string> }>();
  for (const snapshot of snapshots) {
    const snapshotData = readJsonFile<SnapshotData>(join(historyDir, snapshot.file));
    bySnapshot.set(snapshot.file, {
      maps: toListingIdSet(snapshotData, repoRoot, "maps"),
      mods: toListingIdSet(snapshotData, repoRoot, "mods"),
    });
  }
  return bySnapshot;
}

export function toListingVersionSet(
  snapshot: SnapshotData,
  repoRoot: string,
  listingType: "maps" | "mods",
): Set<string> {
  const versions = new Set<string>();
  const downloads = snapshot?.[listingType]?.downloads;
  if (!downloads || typeof downloads !== "object") return versions;

  for (const [id, versionMap] of Object.entries(downloads)) {
    if (isTestListing(repoRoot, listingType, id)) continue;
    if (!versionMap || typeof versionMap !== "object") continue;
    for (const version of Object.keys(versionMap)) {
      versions.add(`${id}@@${version}`);
    }
  }

  return versions;
}

export function buildListingVersionsBySnapshot(
  snapshots: SnapshotEntry[],
  historyDir: string,
  repoRoot: string,
): Map<string, { maps: Set<string>; mods: Set<string> }> {
  const bySnapshot = new Map<string, { maps: Set<string>; mods: Set<string> }>();
  for (const snapshot of snapshots) {
    const snapshotData = readJsonFile<SnapshotData>(join(historyDir, snapshot.file));
    bySnapshot.set(snapshot.file, {
      maps: toListingVersionSet(snapshotData, repoRoot, "maps"),
      mods: toListingVersionSet(snapshotData, repoRoot, "mods"),
    });
  }
  return bySnapshot;
}

export function buildMonotonicSnapshotTotals(
  snapshots: SnapshotEntry[],
  historyDir: string,
): Map<string, ListingTotals> {
  const monotonicBySnapshot = new Map<string, ListingTotals>();
  const runningMax = new Map<ListingKey, number>();

  for (const snapshot of snapshots) {
    const snapshotData = readJsonFile<SnapshotData>(join(historyDir, snapshot.file));
    const adjustedTotals = toListingTotals(snapshotData);
    const snapshotMonotonic = new Map<ListingKey, number>();
    const keys = new Set<ListingKey>([
      ...runningMax.keys(),
      ...adjustedTotals.keys(),
    ]);

    for (const key of keys) {
      const previousMax = runningMax.get(key) ?? 0;
      const adjustedTotal = adjustedTotals.get(key) ?? 0;
      const nextMax = Math.max(previousMax, adjustedTotal);
      if (nextMax > 0 || adjustedTotals.has(key) || runningMax.has(key)) {
        runningMax.set(key, nextMax);
        snapshotMonotonic.set(key, nextMax);
      }
    }

    monotonicBySnapshot.set(snapshot.file, snapshotMonotonic);
  }

  return monotonicBySnapshot;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function findSnapshotAtOrBefore(snapshots: SnapshotEntry[], targetDate: Date): SnapshotEntry | null {
  return findLastAtOrBefore(snapshots, (entry) => entry.date.getTime(), targetDate.getTime());
}

export function resolveBaselineSnapshot(snapshots: SnapshotEntry[], latestDate: Date, days: number): SnapshotEntry {
  const target = addDays(latestDate, -days);
  return findSnapshotAtOrBefore(snapshots, target) ?? snapshots[0];
}
