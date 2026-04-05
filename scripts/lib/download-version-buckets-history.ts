import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestType } from "./manifests.js";
import {
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
  type DownloadVersionBucketLedger,
} from "./download-version-buckets.js";

const SNAPSHOT_PATTERN = /^snapshot_(\d{4}_\d{2}_\d{2})\.json$/;

interface SnapshotSectionLike {
  downloads?: unknown;
}

interface SnapshotLike {
  maps?: SnapshotSectionLike;
  mods?: SnapshotSectionLike;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function normalizeDownloads(raw: unknown): Record<string, Record<string, number>> {
  if (!isObject(raw)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [listingId, versionsRaw] of Object.entries(raw)) {
    if (!isObject(versionsRaw)) continue;
    const versions: Record<string, number> = {};
    for (const [version, countRaw] of Object.entries(versionsRaw)) {
      const count = toFiniteNonNegativeNumber(countRaw);
      if (count === null) continue;
      versions[version] = count;
    }
    result[listingId] = versions;
  }
  return result;
}

function maxMergeInto(
  target: Record<string, Record<string, number>>,
  source: Record<string, Record<string, number>>,
): void {
  for (const [listingId, versions] of Object.entries(source)) {
    const listingTarget = target[listingId] ?? {};
    for (const [version, count] of Object.entries(versions)) {
      listingTarget[version] = Math.max(listingTarget[version] ?? 0, count);
    }
    target[listingId] = listingTarget;
  }
}

function applyHistoryMaximaToLedger(
  ledger: DownloadVersionBucketLedger,
  maxima: Record<string, Record<string, number>>,
  nowIso: string,
): void {
  for (const [listingId, versions] of Object.entries(maxima)) {
    const listingEntry = ledger.listings[listingId] ?? { versions: {} };
    for (const [version, maxCount] of Object.entries(versions)) {
      const versionEntry = listingEntry.versions[version];
      if (!versionEntry) {
        listingEntry.versions[version] = {
          max_total_downloads: maxCount,
          buckets: {
            [`history-max:${listingId}:${version}`]: {
              max_adjusted_downloads: maxCount,
              last_adjusted_downloads: maxCount,
              updated_at: nowIso,
            },
          },
          updated_at: nowIso,
        };
        continue;
      }
      if (versionEntry.max_total_downloads >= maxCount) {
        continue;
      }
      const fallbackBucketKey = `history-max:${listingId}:${version}`;
      const existingFallback = versionEntry.buckets[fallbackBucketKey];
      versionEntry.buckets[fallbackBucketKey] = {
        max_adjusted_downloads: Math.max(existingFallback?.max_adjusted_downloads ?? 0, maxCount),
        last_adjusted_downloads: maxCount,
        updated_at: nowIso,
      };
      versionEntry.max_total_downloads = Object.values(versionEntry.buckets)
        .reduce((sum, bucket) => sum + bucket.max_adjusted_downloads, 0);
      versionEntry.updated_at = nowIso;
    }
    ledger.listings[listingId] = listingEntry;
  }
  ledger.updated_at = nowIso;
}

function toListingType(kind: "maps" | "mods"): ManifestType {
  return kind === "maps" ? "map" : "mod";
}

export interface RebuildDownloadVersionBucketsResult {
  mapsListingVersionsSeeded: number;
  modsListingVersionsSeeded: number;
  snapshotFilesScanned: number;
}

export function rebuildDownloadVersionBucketsFromHistory(
  repoRoot: string,
  nowIso = new Date().toISOString(),
): RebuildDownloadVersionBucketsResult {
  const historyDir = resolve(repoRoot, "history");
  const maximaByKind: Record<"maps" | "mods", Record<string, Record<string, number>>> = {
    maps: {},
    mods: {},
  };

  let snapshotFilesScanned = 0;
  if (existsSync(historyDir)) {
    const snapshotFiles = readdirSync(historyDir)
      .filter((fileName) => SNAPSHOT_PATTERN.test(fileName))
      .sort();
    for (const fileName of snapshotFiles) {
      snapshotFilesScanned += 1;
      const snapshotPath = resolve(historyDir, fileName);
      let snapshot: SnapshotLike;
      try {
        snapshot = readJsonFile<SnapshotLike>(snapshotPath);
      } catch {
        continue;
      }
      maxMergeInto(maximaByKind.maps, normalizeDownloads(snapshot.maps?.downloads));
      maxMergeInto(maximaByKind.mods, normalizeDownloads(snapshot.mods?.downloads));
    }
  }

  let mapsListingVersionsSeeded = 0;
  let modsListingVersionsSeeded = 0;
  for (const kind of ["maps", "mods"] as const) {
    const listingType = toListingType(kind);
    const ledger = loadDownloadVersionBucketLedger(repoRoot, listingType);
    applyHistoryMaximaToLedger(ledger, maximaByKind[kind], nowIso);
    writeDownloadVersionBucketLedger(repoRoot, listingType, ledger);

    const count = Object.values(maximaByKind[kind])
      .reduce((sum, versions) => sum + Object.keys(versions).length, 0);
    if (kind === "maps") {
      mapsListingVersionsSeeded = count;
    } else {
      modsListingVersionsSeeded = count;
    }
  }

  return {
    mapsListingVersionsSeeded,
    modsListingVersionsSeeded,
    snapshotFilesScanned,
  };
}
