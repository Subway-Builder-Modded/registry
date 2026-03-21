import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadsByListing } from "./download-definitions.js";

type ListingKind = "maps" | "mods";

interface IndexFile {
  schema_version?: number;
  maps?: unknown;
  mods?: unknown;
  [key: string]: unknown;
}

interface DownloadHistorySection {
  downloads: DownloadsByListing;
  total_downloads: number;
  net_downloads: number;
  index: IndexFile;
  entries: number;
}

export interface DownloadHistorySnapshot {
  schema_version: 1;
  snapshot_date: string;
  generated_at: string;
  maps: DownloadHistorySection;
  mods: DownloadHistorySection;
}

export interface GenerateDownloadHistoryOptions {
  repoRoot: string;
  now?: Date;
}

export interface GenerateDownloadHistoryResult {
  snapshotFile: string;
  previousSnapshotFile: string | null;
  snapshot: DownloadHistorySnapshot;
  warnings: string[];
}

export interface BackfillDownloadHistoryOptions {
  repoRoot: string;
}

export interface BackfillDownloadHistoryResult {
  updatedFiles: string[];
  warnings: string[];
}

const SNAPSHOT_PATTERN = /^snapshot_(\d{4}_\d{2}_\d{2})\.json$/;

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function toSnapshotDate(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "_");
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDownloads(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must be a JSON object`);
  }

  const input = raw as Record<string, unknown>;
  const result: DownloadsByListing = {};
  for (const listingId of Object.keys(input).sort()) {
    const versionsRaw = input[listingId];
    if (typeof versionsRaw !== "object" || versionsRaw === null || Array.isArray(versionsRaw)) {
      warnings.push(`${listingKind}: listing='${listingId}' has non-object versions payload; treating as empty`);
      result[listingId] = {};
      continue;
    }

    const versionsInput = versionsRaw as Record<string, unknown>;
    const versionsResult: Record<string, number> = {};
    for (const version of Object.keys(versionsInput).sort()) {
      const parsed = asFiniteNumber(versionsInput[version]);
      if (parsed === null) {
        warnings.push(
          `${listingKind}: listing='${listingId}' version='${version}' has non-numeric download count; skipping version`,
        );
        continue;
      }
      versionsResult[version] = parsed;
    }
    result[listingId] = versionsResult;
  }
  return result;
}

function computeTotalDownloads(downloads: DownloadsByListing): number {
  let total = 0;
  for (const versions of Object.values(downloads)) {
    for (const count of Object.values(versions)) {
      total += count;
    }
  }
  return total;
}

function readListingData(
  repoRoot: string,
  listingKind: ListingKind,
  warnings: string[],
): { downloads: DownloadsByListing; totalDownloads: number; index: IndexFile; entries: number } {
  const downloadsPath = resolve(repoRoot, listingKind, "downloads.json");
  const indexPath = resolve(repoRoot, listingKind, "index.json");
  const downloadsRaw = readJsonFile<unknown>(downloadsPath);
  const downloads = normalizeDownloads(downloadsRaw, listingKind, warnings, `${listingKind}/downloads.json`);
  const totalDownloads = computeTotalDownloads(downloads);
  const index = readJsonFile<IndexFile>(indexPath);

  const rawEntries = index[listingKind];
  const entries = Array.isArray(rawEntries) ? rawEntries.length : 0;
  if (!Array.isArray(rawEntries)) {
    warnings.push(`${listingKind}: index.json field '${listingKind}' is not an array; entries set to 0`);
  }

  return {
    downloads,
    totalDownloads,
    index,
    entries,
  };
}

function getHistoryDir(repoRoot: string): string {
  return resolve(repoRoot, "history");
}

function listSnapshotFileNames(historyDir: string): string[] {
  if (!existsSync(historyDir)) {
    return [];
  }
  return readdirSync(historyDir)
    .filter((name) => SNAPSHOT_PATTERN.test(name))
    .sort();
}

function readPreviousSnapshot(
  repoRoot: string,
  currentSnapshotFileName: string,
  warnings: string[],
): { fileName: string; snapshot: DownloadHistorySnapshot } | null {
  const historyDir = getHistoryDir(repoRoot);
  const previousFiles = listSnapshotFileNames(historyDir)
    .filter((name) => name < currentSnapshotFileName);
  if (previousFiles.length === 0) {
    return null;
  }

  const fileName = previousFiles[previousFiles.length - 1]!;
  try {
    const snapshot = readJsonFile<DownloadHistorySnapshot>(resolve(historyDir, fileName));
    return { fileName, snapshot };
  } catch {
    warnings.push(`history: failed to parse previous snapshot '${fileName}'; using first-run net calculation`);
    return null;
  }
}

function resolvePreviousDownloads(
  previousSnapshot: DownloadHistorySnapshot | null,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  if (!previousSnapshot) {
    return {};
  }

  try {
    return normalizeDownloads(previousSnapshot[listingKind].downloads, listingKind, warnings, sourceLabel);
  } catch {
    warnings.push(`history: previous snapshot has invalid ${listingKind}.downloads payload; treating as empty`);
    return {};
  }
}

function mergeDownloadsWithPrevious(
  currentDownloads: DownloadsByListing,
  previousDownloads: DownloadsByListing,
): DownloadsByListing {
  const listingIds = new Set<string>([
    ...Object.keys(previousDownloads),
    ...Object.keys(currentDownloads),
  ]);

  const merged: DownloadsByListing = {};
  for (const listingId of Array.from(listingIds).sort()) {
    const currentVersions = currentDownloads[listingId] ?? {};
    const previousVersions = previousDownloads[listingId] ?? {};
    const versions = new Set<string>([
      ...Object.keys(previousVersions),
      ...Object.keys(currentVersions),
    ]);

    const mergedVersions: Record<string, number> = {};
    for (const version of Array.from(versions).sort()) {
      const currentCount = currentVersions[version];
      const previousCount = previousVersions[version];
      if (typeof currentCount === "number" && typeof previousCount === "number") {
        mergedVersions[version] = Math.max(currentCount, previousCount);
        continue;
      }
      if (typeof currentCount === "number") {
        mergedVersions[version] = currentCount;
        continue;
      }
      if (typeof previousCount === "number") {
        mergedVersions[version] = previousCount;
      }
    }

    merged[listingId] = mergedVersions;
  }

  return merged;
}

function resolvePreviousTotal(
  previousSnapshot: DownloadHistorySnapshot | null,
  listingKind: ListingKind,
  previousDownloads: DownloadsByListing,
  warnings: string[],
): number | null {
  if (!previousSnapshot) return null;
  const section = previousSnapshot[listingKind];
  const total = section?.total_downloads;
  if (typeof total !== "number" || !Number.isFinite(total)) {
    const fallbackTotal = computeTotalDownloads(previousDownloads);
    warnings.push(`history: previous snapshot missing finite ${listingKind}.total_downloads; using ${listingKind}.downloads sum=${fallbackTotal}`);
    return fallbackTotal;
  }
  return total;
}

function computeNetDownloads(
  currentTotal: number,
  previousTotal: number | null,
  listingKind: ListingKind,
  warnings: string[],
): number {
  if (previousTotal === null) {
    return currentTotal;
  }
  const netDownloads = currentTotal - previousTotal;
  if (netDownloads < 0) {
    warnings.push(
      `history: computed negative ${listingKind}.net_downloads=${netDownloads}; clamping to 0 to preserve monotonic totals`,
    );
    return 0;
  }
  return netDownloads;
}

function toIndexFallback(listingKind: ListingKind): IndexFile {
  return {
    schema_version: 1,
    [listingKind]: [],
  };
}

function asIndexFileOrFallback(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): IndexFile {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as IndexFile;
  }
  warnings.push(`${sourceLabel} has non-object index payload; using fallback index`);
  return toIndexFallback(listingKind);
}

function asEntriesOrFallback(
  raw: unknown,
  listingKind: ListingKind,
  index: IndexFile,
  warnings: string[],
  sourceLabel: string,
): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }

  const candidates = index[listingKind];
  if (Array.isArray(candidates)) {
    warnings.push(`${sourceLabel} has invalid entries value; using '${listingKind}' array length from index`);
    return candidates.length;
  }

  warnings.push(`${sourceLabel} has invalid entries value; using fallback 0`);
  return 0;
}

export function generateDownloadHistorySnapshot(
  options: GenerateDownloadHistoryOptions,
): GenerateDownloadHistoryResult {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const snapshotDate = toSnapshotDate(now);
  const snapshotFileName = `snapshot_${snapshotDate}.json`;
  const previous = readPreviousSnapshot(options.repoRoot, snapshotFileName, warnings);

  const mapsData = readListingData(options.repoRoot, "maps", warnings);
  const modsData = readListingData(options.repoRoot, "mods", warnings);

  const previousMapsDownloads = resolvePreviousDownloads(
    previous?.snapshot ?? null,
    "maps",
    warnings,
    "history/previous/maps.downloads",
  );
  const previousModsDownloads = resolvePreviousDownloads(
    previous?.snapshot ?? null,
    "mods",
    warnings,
    "history/previous/mods.downloads",
  );
  const mergedMapsDownloads = mergeDownloadsWithPrevious(mapsData.downloads, previousMapsDownloads);
  const mergedModsDownloads = mergeDownloadsWithPrevious(modsData.downloads, previousModsDownloads);

  const mapsTotalDownloads = computeTotalDownloads(mergedMapsDownloads);
  const modsTotalDownloads = computeTotalDownloads(mergedModsDownloads);

  const previousMapsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "maps", previousMapsDownloads, warnings);
  const previousModsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "mods", previousModsDownloads, warnings);

  const snapshot: DownloadHistorySnapshot = {
    schema_version: 1,
    snapshot_date: snapshotDate,
    generated_at: now.toISOString(),
    maps: {
      downloads: mergedMapsDownloads,
      total_downloads: mapsTotalDownloads,
      net_downloads: computeNetDownloads(mapsTotalDownloads, previousMapsTotal, "maps", warnings),
      index: mapsData.index,
      entries: mapsData.entries,
    },
    mods: {
      downloads: mergedModsDownloads,
      total_downloads: modsTotalDownloads,
      net_downloads: computeNetDownloads(modsTotalDownloads, previousModsTotal, "mods", warnings),
      index: modsData.index,
      entries: modsData.entries,
    },
  };

  const historyDir = getHistoryDir(options.repoRoot);
  mkdirSync(historyDir, { recursive: true });
  const snapshotPath = resolve(historyDir, snapshotFileName);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");

  return {
    snapshotFile: `history/${snapshotFileName}`,
    previousSnapshotFile: previous ? `history/${previous.fileName}` : null,
    snapshot,
    warnings,
  };
}

export function backfillDownloadHistorySnapshots(
  options: BackfillDownloadHistoryOptions,
): BackfillDownloadHistoryResult {
  const warnings: string[] = [];
  const historyDir = getHistoryDir(options.repoRoot);
  const snapshotFiles = listSnapshotFileNames(historyDir);
  const updatedFiles: string[] = [];
  let previousSnapshot: DownloadHistorySnapshot | null = null;

  for (const fileName of snapshotFiles) {
    const snapshotPath = resolve(historyDir, fileName);
    let snapshot: DownloadHistorySnapshot;
    try {
      snapshot = readJsonFile<DownloadHistorySnapshot>(snapshotPath);
    } catch {
      warnings.push(`history: failed to parse '${fileName}'; skipping backfill for this file`);
      continue;
    }

    const sourceMapsDownloads = resolvePreviousDownloads(
      snapshot,
      "maps",
      warnings,
      `history/${fileName}:maps.downloads`,
    );
    const sourceModsDownloads = resolvePreviousDownloads(
      snapshot,
      "mods",
      warnings,
      `history/${fileName}:mods.downloads`,
    );
    const previousMapsDownloads = previousSnapshot?.maps.downloads ?? {};
    const previousModsDownloads = previousSnapshot?.mods.downloads ?? {};

    const mergedMapsDownloads = mergeDownloadsWithPrevious(sourceMapsDownloads, previousMapsDownloads);
    const mergedModsDownloads = mergeDownloadsWithPrevious(sourceModsDownloads, previousModsDownloads);
    const mapsTotalDownloads = computeTotalDownloads(mergedMapsDownloads);
    const modsTotalDownloads = computeTotalDownloads(mergedModsDownloads);

    const mapsIndex = asIndexFileOrFallback(
      snapshot.maps?.index,
      "maps",
      warnings,
      `history/${fileName}:maps.index`,
    );
    const modsIndex = asIndexFileOrFallback(
      snapshot.mods?.index,
      "mods",
      warnings,
      `history/${fileName}:mods.index`,
    );

    const mapsEntries = asEntriesOrFallback(
      snapshot.maps?.entries,
      "maps",
      mapsIndex,
      warnings,
      `history/${fileName}:maps.entries`,
    );
    const modsEntries = asEntriesOrFallback(
      snapshot.mods?.entries,
      "mods",
      modsIndex,
      warnings,
      `history/${fileName}:mods.entries`,
    );

    const normalizedSnapshot: DownloadHistorySnapshot = {
      schema_version: 1,
      snapshot_date: snapshot.snapshot_date,
      generated_at: snapshot.generated_at,
      maps: {
        downloads: mergedMapsDownloads,
        total_downloads: mapsTotalDownloads,
        net_downloads: computeNetDownloads(
          mapsTotalDownloads,
          previousSnapshot?.maps.total_downloads ?? null,
          "maps",
          warnings,
        ),
        index: mapsIndex,
        entries: mapsEntries,
      },
      mods: {
        downloads: mergedModsDownloads,
        total_downloads: modsTotalDownloads,
        net_downloads: computeNetDownloads(
          modsTotalDownloads,
          previousSnapshot?.mods.total_downloads ?? null,
          "mods",
          warnings,
        ),
        index: modsIndex,
        entries: modsEntries,
      },
    };

    const normalizedRaw = `${JSON.stringify(normalizedSnapshot, null, 2)}\n`;
    const existingRaw = readFileSync(snapshotPath, "utf-8");
    if (existingRaw !== normalizedRaw) {
      writeFileSync(snapshotPath, normalizedRaw, "utf-8");
      updatedFiles.push(`history/${fileName}`);
    }

    previousSnapshot = normalizedSnapshot;
  }

  return {
    updatedFiles,
    warnings,
  };
}
