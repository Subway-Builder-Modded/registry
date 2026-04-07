import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareStableSemverDesc,
  normalizeStableSemverTag,
  parseStableSemverTag,
} from "./semver.js";
export { normalizeStableSemverTag } from "./semver.js";
import { isObject, toFiniteNonNegativeNumber, sortObjectByKeys } from "./json-utils.js";

const RAILYARD_APP_DOWNLOAD_HISTORY_FILE = ["history", "railyard_app_downloads.json"] as const;

export interface GitHubReleaseAssetLike {
  name: string;
  download_count: number;
}

export interface GitHubReleaseLike {
  tag_name: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubReleaseAssetLike[];
}

export interface RailyardAppVersionSnapshot {
  total_downloads: number;
  assets: Record<string, number>;
}

export interface RailyardAppHistorySnapshot {
  captured_at: string;
  versions: Record<string, RailyardAppVersionSnapshot>;
}

export interface RailyardAppDownloadHistory {
  schema_version: 1;
  repo: string;
  updated_at: string;
  snapshots: Record<string, RailyardAppHistorySnapshot>;
}

export interface RailyardAppVersionAnalyticsAsset {
  total_downloads: number;
  last_1d_downloads: number | null;
  last_3d_downloads: number | null;
  last_7d_downloads: number | null;
}

export interface RailyardAppVersionAnalytics {
  total_downloads: number;
  last_1d_downloads: number | null;
  last_3d_downloads: number | null;
  last_7d_downloads: number | null;
  assets: Record<string, RailyardAppVersionAnalyticsAsset>;
}

export interface RailyardAppAnalytics {
  schema_version: 1;
  repo: string;
  generated_at: string;
  latest_snapshot: string | null;
  versions: Record<string, RailyardAppVersionAnalytics>;
}

export interface RailyardAppCsvRow {
  version: string;
  total_downloads: number;
  last_1d_downloads: number | "";
  last_3d_downloads: number | "";
  last_7d_downloads: number | "";
  [key: string]: string | number | null;
}

export interface RailyardAppByDayCsvRow {
  version: string;
  total_downloads: number;
  [key: string]: string | number;
}

export function getRailyardAppDownloadHistoryPath(repoRoot: string): string {
  return resolve(repoRoot, ...RAILYARD_APP_DOWNLOAD_HISTORY_FILE);
}

export function toHourBucketIso(date: Date): string {
  const bucket = new Date(date.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function compareSemverDescending(a: string, b: string): number {
  return compareStableSemverDesc(a, b);
}

export function createEmptyRailyardAppDownloadHistory(
  repo = "Subway-Builder-Modded/railyard",
  nowIso = new Date().toISOString(),
): RailyardAppDownloadHistory {
  return {
    schema_version: 1,
    repo,
    updated_at: nowIso,
    snapshots: {},
  };
}

export function normalizeRailyardAppDownloadHistory(
  value: unknown,
  fallbackRepo = "Subway-Builder-Modded/railyard",
  nowIso = new Date().toISOString(),
): RailyardAppDownloadHistory {
  if (!isObject(value) || value.schema_version !== 1) {
    return createEmptyRailyardAppDownloadHistory(fallbackRepo, nowIso);
  }

  const snapshots: Record<string, RailyardAppHistorySnapshot> = {};
  if (isObject(value.snapshots)) {
    for (const [snapshotKey, snapshotValue] of Object.entries(value.snapshots)) {
      if (!isObject(snapshotValue) || !isObject(snapshotValue.versions)) continue;
      const versions: Record<string, RailyardAppVersionSnapshot> = {};
      for (const [version, versionValue] of Object.entries(snapshotValue.versions)) {
        if (!isObject(versionValue)) continue;
        const total = toFiniteNonNegativeNumber(versionValue.total_downloads);
        if (total === null) continue;
        const assets: Record<string, number> = {};
        if (isObject(versionValue.assets)) {
          for (const [assetName, count] of Object.entries(versionValue.assets)) {
            const parsedCount = toFiniteNonNegativeNumber(count);
            if (parsedCount === null) continue;
            assets[assetName] = parsedCount;
          }
        }
        versions[version] = {
          total_downloads: total,
          assets: sortObjectByKeys(assets),
        };
      }
      snapshots[snapshotKey] = {
        captured_at: typeof snapshotValue.captured_at === "string" && snapshotValue.captured_at.trim() !== ""
          ? snapshotValue.captured_at
          : snapshotKey,
        versions: sortVersionsRecord(versions),
      };
    }
  }

  return {
    schema_version: 1,
    repo: typeof value.repo === "string" && value.repo.trim() !== "" ? value.repo : fallbackRepo,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== "" ? value.updated_at : nowIso,
    snapshots: sortObjectByKeys(snapshots),
  };
}

export function loadRailyardAppDownloadHistory(
  repoRoot: string,
  fallbackRepo = "Subway-Builder-Modded/railyard",
  nowIso = new Date().toISOString(),
): RailyardAppDownloadHistory {
  const path = getRailyardAppDownloadHistoryPath(repoRoot);
  if (!existsSync(path)) {
    return createEmptyRailyardAppDownloadHistory(fallbackRepo, nowIso);
  }
  return normalizeRailyardAppDownloadHistory(
    JSON.parse(readFileSync(path, "utf-8")) as unknown,
    fallbackRepo,
    nowIso,
  );
}

export function writeRailyardAppDownloadHistory(repoRoot: string, history: RailyardAppDownloadHistory): void {
  writeFileSync(
    getRailyardAppDownloadHistoryPath(repoRoot),
    `${JSON.stringify(history, null, 2)}\n`,
    "utf-8",
  );
}

function sortVersionsRecord<T>(versions: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const version of Object.keys(versions).sort(compareSemverDescending)) {
    sorted[version] = versions[version]!;
  }
  return sorted;
}

function normalizeAssetCounts(value: Record<string, number>): Record<string, number> {
  return sortObjectByKeys(
    Object.fromEntries(
      Object.entries(value).filter(([, count]) => Number.isFinite(count) && count >= 0),
    ),
  );
}

export function buildRailyardAppHistorySnapshot(
  releases: GitHubReleaseLike[],
  capturedAt = new Date().toISOString(),
): RailyardAppHistorySnapshot {
  const versions: Record<string, RailyardAppVersionSnapshot> = {};

  for (const release of releases) {
    if (release.draft === true || release.prerelease === true) continue;
    const normalizedVersion = normalizeStableSemverTag(release.tag_name);
    if (!normalizedVersion) continue;

    const assets: Record<string, number> = {};
    let totalDownloads = 0;
    for (const asset of release.assets ?? []) {
      const count = toFiniteNonNegativeNumber(asset.download_count);
      if (count === null) continue;
      assets[asset.name] = count;
      totalDownloads += count;
    }

    versions[normalizedVersion] = {
      total_downloads: totalDownloads,
      assets: normalizeAssetCounts(assets),
    };
  }

  return {
    captured_at: capturedAt,
    versions: sortVersionsRecord(versions),
  };
}

export function upsertRailyardAppHistorySnapshot(params: {
  history: RailyardAppDownloadHistory;
  snapshot: RailyardAppHistorySnapshot;
  snapshotKey: string;
  updatedAt?: string;
}): RailyardAppDownloadHistory {
  const nextSnapshots = {
    ...params.history.snapshots,
    [params.snapshotKey]: {
      captured_at: params.snapshot.captured_at,
      versions: sortVersionsRecord(params.snapshot.versions),
    },
  };

  return {
    schema_version: 1,
    repo: params.history.repo,
    updated_at: params.updatedAt ?? params.snapshot.captured_at,
    snapshots: sortObjectByKeys(nextSnapshots),
  };
}

function listSnapshotKeys(history: RailyardAppDownloadHistory): string[] {
  return Object.keys(history.snapshots).sort((a, b) => Date.parse(a) - Date.parse(b));
}

function toDateKey(isoValue: string): string | null {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "_");
}

function findSnapshotAtOrBefore(history: RailyardAppDownloadHistory, targetMs: number): string | null {
  let selected: string | null = null;
  for (const key of listSnapshotKeys(history)) {
    const keyMs = Date.parse(key);
    if (!Number.isFinite(keyMs)) continue;
    if (keyMs <= targetMs) {
      selected = key;
    } else {
      break;
    }
  }
  return selected;
}

function toWindowDelta(current: number, baseline: number): number {
  return Math.max(0, current - baseline);
}

function toOptionalWindowDelta(current: number, baseline: number | null): number | null {
  if (baseline === null) return null;
  return toWindowDelta(current, baseline);
}

export function buildRailyardAppAnalytics(
  history: RailyardAppDownloadHistory,
  generatedAt = new Date().toISOString(),
): RailyardAppAnalytics {
  const snapshotKeys = listSnapshotKeys(history);
  const latestSnapshotKey = snapshotKeys[snapshotKeys.length - 1] ?? null;
  if (!latestSnapshotKey) {
    return {
      schema_version: 1,
      repo: history.repo,
      generated_at: generatedAt,
      latest_snapshot: null,
      versions: {},
    };
  }

  const latestSnapshot = history.snapshots[latestSnapshotKey]!;
  const latestMs = Date.parse(latestSnapshotKey);
  const baseline1d = findSnapshotAtOrBefore(history, latestMs - (24 * 60 * 60 * 1000));
  const baseline3d = findSnapshotAtOrBefore(history, latestMs - (3 * 24 * 60 * 60 * 1000));
  const baseline7d = findSnapshotAtOrBefore(history, latestMs - (7 * 24 * 60 * 60 * 1000));

  const analyticsVersions: Record<string, RailyardAppVersionAnalytics> = {};
  for (const [version, latestVersion] of Object.entries(latestSnapshot.versions)) {
    if (latestVersion.total_downloads <= 0) continue;
    const baselineVersion1d = baseline1d ? history.snapshots[baseline1d]?.versions[version] : undefined;
    const baselineVersion3d = baseline3d ? history.snapshots[baseline3d]?.versions[version] : undefined;
    const baselineVersion7d = baseline7d ? history.snapshots[baseline7d]?.versions[version] : undefined;

    const assetNames = new Set<string>(Object.keys(latestVersion.assets));
    const assets: Record<string, RailyardAppVersionAnalyticsAsset> = {};
    for (const assetName of [...assetNames].sort()) {
      const latestAssetTotal = latestVersion.assets[assetName] ?? 0;
      assets[assetName] = {
        total_downloads: latestAssetTotal,
        last_1d_downloads: toOptionalWindowDelta(
          latestAssetTotal,
          baseline1d ? (baselineVersion1d?.assets[assetName] ?? 0) : null,
        ),
        last_3d_downloads: toOptionalWindowDelta(
          latestAssetTotal,
          baseline3d ? (baselineVersion3d?.assets[assetName] ?? 0) : null,
        ),
        last_7d_downloads: toOptionalWindowDelta(
          latestAssetTotal,
          baseline7d ? (baselineVersion7d?.assets[assetName] ?? 0) : null,
        ),
      };
    }

    analyticsVersions[version] = {
      total_downloads: latestVersion.total_downloads,
      last_1d_downloads: toOptionalWindowDelta(
        latestVersion.total_downloads,
        baseline1d ? (baselineVersion1d?.total_downloads ?? 0) : null,
      ),
      last_3d_downloads: toOptionalWindowDelta(
        latestVersion.total_downloads,
        baseline3d ? (baselineVersion3d?.total_downloads ?? 0) : null,
      ),
      last_7d_downloads: toOptionalWindowDelta(
        latestVersion.total_downloads,
        baseline7d ? (baselineVersion7d?.total_downloads ?? 0) : null,
      ),
      assets,
    };
  }

  return {
    schema_version: 1,
    repo: history.repo,
    generated_at: generatedAt,
    latest_snapshot: latestSnapshotKey,
    versions: sortVersionsRecord(analyticsVersions),
  };
}

export function listRailyardAppAnalyticsAssetNames(analytics: RailyardAppAnalytics): string[] {
  const latestAssets = new Set<string>();
  for (const version of Object.values(analytics.versions)) {
    for (const assetName of Object.keys(version.assets)) {
      latestAssets.add(assetName);
    }
  }
  return [...latestAssets].sort((a, b) => a.localeCompare(b));
}

export function buildRailyardAppAnalyticsCsvRows(analytics: RailyardAppAnalytics): RailyardAppCsvRow[] {
  const assetNames = listRailyardAppAnalyticsAssetNames(analytics);
  return Object.entries(analytics.versions).map(([version, entry]) => {
    const row: RailyardAppCsvRow = {
      version,
      total_downloads: entry.total_downloads,
      last_1d_downloads: entry.last_1d_downloads ?? "",
      last_3d_downloads: entry.last_3d_downloads ?? "",
      last_7d_downloads: entry.last_7d_downloads ?? "",
    };

    for (const assetName of assetNames) {
      const asset = entry.assets[assetName];
      row[`${assetName}_total_downloads`] = asset?.total_downloads ?? 0;
      row[`${assetName}_last_1d_downloads`] = asset?.last_1d_downloads ?? "";
      row[`${assetName}_last_3d_downloads`] = asset?.last_3d_downloads ?? "";
      row[`${assetName}_last_7d_downloads`] = asset?.last_7d_downloads ?? "";
    }

    return row;
  });
}

export function buildRailyardAppByDayCsvRows(history: RailyardAppDownloadHistory): {
  headers: string[];
  rows: RailyardAppByDayCsvRow[];
} {
  const snapshotKeys = listSnapshotKeys(history);
  const latestSnapshotKey = snapshotKeys[snapshotKeys.length - 1] ?? null;
  if (!latestSnapshotKey) {
    return {
      headers: ["version", "total_downloads"],
      rows: [],
    };
  }

  const dayToSnapshot = new Map<string, RailyardAppHistorySnapshot>();
  for (const key of snapshotKeys) {
    const dateKey = toDateKey(key);
    if (!dateKey) continue;
    dayToSnapshot.set(dateKey, history.snapshots[key]!);
  }

  const dateKeys = [...dayToSnapshot.keys()].sort();
  const latestSnapshot = history.snapshots[latestSnapshotKey]!;
  const previousTotals = new Map<string, number>();
  const dailyByVersion = new Map<string, Record<string, number>>();

  for (const dateKey of dateKeys) {
    const snapshot = dayToSnapshot.get(dateKey)!;
    const currentTotals = new Map<string, number>();
    const versionKeys = new Set<string>([
      ...Object.keys(snapshot.versions),
      ...previousTotals.keys(),
    ]);

    for (const version of versionKeys) {
      const currentTotal = snapshot.versions[version]?.total_downloads ?? previousTotals.get(version) ?? 0;
      currentTotals.set(version, currentTotal);
      const previousTotal = previousTotals.get(version) ?? 0;
      const delta = Math.max(0, currentTotal - previousTotal);
      const row = dailyByVersion.get(version) ?? {};
      row[dateKey] = delta;
      dailyByVersion.set(version, row);
    }

    previousTotals.clear();
    for (const [version, total] of currentTotals.entries()) {
      previousTotals.set(version, total);
    }
  }

  const rows = Object.entries(latestSnapshot.versions)
    .filter(([, snapshot]) => snapshot.total_downloads > 0)
    .sort(([a], [b]) => compareSemverDescending(a, b))
    .map(([version, snapshot]) => {
      const row: RailyardAppByDayCsvRow = {
        version,
        total_downloads: snapshot.total_downloads,
      };
      for (const dateKey of dateKeys) {
        row[dateKey] = dailyByVersion.get(version)?.[dateKey] ?? 0;
      }
      return row;
    });

  return {
    headers: ["version", "total_downloads", ...dateKeys],
    rows,
  };
}
