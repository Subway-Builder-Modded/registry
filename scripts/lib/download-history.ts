import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadsByListing } from "./download-definitions.js";

type ListingKind = "maps" | "mods";
type ValidVersionsByListing = Record<string, Set<string>>;

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

interface IntegrityVersionLike {
  is_complete?: unknown;
}

interface IntegrityListingLike {
  versions?: unknown;
  complete_versions?: unknown;
}

interface IntegrityOutputLike {
  listings?: unknown;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDownloads(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  if (!isObject(raw)) {
    throw new Error(`${sourceLabel} must be a JSON object`);
  }

  const result: DownloadsByListing = {};
  for (const listingId of Object.keys(raw).sort()) {
    const versionsRaw = raw[listingId];
    if (!isObject(versionsRaw)) {
      warnings.push(`${sourceLabel}: listing='${listingId}' has non-object versions payload; treating as empty`);
      result[listingId] = {};
      continue;
    }

    const versionsResult: Record<string, number> = {};
    for (const version of Object.keys(versionsRaw).sort()) {
      const parsed = asFiniteNumber(versionsRaw[version]);
      if (parsed === null) {
        warnings.push(
          `${sourceLabel}: listing='${listingId}' version='${version}' has non-numeric download count; skipping version`,
        );
        continue;
      }
      versionsResult[version] = parsed;
    }
    result[listingId] = versionsResult;
  }

  return result;
}

function normalizeValidVersionsFromIntegrity(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
): ValidVersionsByListing {
  if (!isObject(raw)) {
    throw new Error(`${listingKind}/integrity.json must be a JSON object`);
  }

  const listings = (raw as IntegrityOutputLike).listings;
  if (!isObject(listings)) {
    throw new Error(`${listingKind}/integrity.json must include an object 'listings' field`);
  }

  const validVersionsByListing: ValidVersionsByListing = {};
  for (const listingId of Object.keys(listings).sort()) {
    const listingRaw = listings[listingId];
    if (!isObject(listingRaw)) {
      warnings.push(`${listingKind}/integrity.json: listing='${listingId}' has non-object payload; treating as empty`);
      validVersionsByListing[listingId] = new Set<string>();
      continue;
    }

    const listing = listingRaw as IntegrityListingLike;
    const validVersions = new Set<string>();
    if (isObject(listing.versions)) {
      for (const version of Object.keys(listing.versions)) {
        const versionRaw = listing.versions[version];
        if (!isObject(versionRaw)) continue;
        if ((versionRaw as IntegrityVersionLike).is_complete === true) {
          validVersions.add(version);
        }
      }
    }

    if (Array.isArray(listing.complete_versions)) {
      for (const version of listing.complete_versions) {
        if (typeof version === "string" && version.trim() !== "") {
          validVersions.add(version);
        }
      }
    }

    validVersionsByListing[listingId] = validVersions;
  }

  return validVersionsByListing;
}

function readValidVersionsFromIntegrity(
  repoRoot: string,
  listingKind: ListingKind,
  warnings: string[],
): ValidVersionsByListing {
  const integrityPath = resolve(repoRoot, listingKind, "integrity.json");
  if (!existsSync(integrityPath)) {
    throw new Error(`${listingKind}/integrity.json is required to generate download history`);
  }

  return normalizeValidVersionsFromIntegrity(
    readJsonFile<unknown>(integrityPath),
    listingKind,
    warnings,
  );
}

function filterDownloadsByIntegrity(
  downloads: DownloadsByListing,
  validVersionsByListing: ValidVersionsByListing,
  sourceLabel: string,
  warnings: string[],
): DownloadsByListing {
  const filtered: DownloadsByListing = {};
  for (const listingId of Object.keys(downloads).sort()) {
    const versions = downloads[listingId] ?? {};
    const validVersions = validVersionsByListing[listingId];
    if (!validVersions) {
      warnings.push(`${sourceLabel}: listing='${listingId}' not found in integrity.json; treating as empty`);
      filtered[listingId] = {};
      continue;
    }

    const filteredVersions: Record<string, number> = {};
    for (const version of Object.keys(versions).sort()) {
      if (!validVersions.has(version)) {
        warnings.push(`${sourceLabel}: listing='${listingId}' version='${version}' is not complete; skipping version`);
        continue;
      }
      filteredVersions[version] = versions[version]!;
    }
    filtered[listingId] = filteredVersions;
  }

  return filtered;
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
  validVersionsByListing: ValidVersionsByListing,
): { downloads: DownloadsByListing; totalDownloads: number; index: IndexFile; entries: number } {
  const downloadsPath = resolve(repoRoot, listingKind, "downloads.json");
  const indexPath = resolve(repoRoot, listingKind, "index.json");
  const downloadsRaw = readJsonFile<unknown>(downloadsPath);
  const normalizedDownloads = normalizeDownloads(
    downloadsRaw,
    listingKind,
    warnings,
    `${listingKind}/downloads.json`,
  );
  const downloads = filterDownloadsByIntegrity(
    normalizedDownloads,
    validVersionsByListing,
    `${listingKind}/downloads.json`,
    warnings,
  );
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

function resolvePreviousTotal(
  previousSnapshot: DownloadHistorySnapshot | null,
  listingKind: ListingKind,
  warnings: string[],
): number | null {
  if (!previousSnapshot) return null;
  const section = previousSnapshot[listingKind];
  const total = section?.total_downloads;
  if (typeof total !== "number" || !Number.isFinite(total)) {
    warnings.push(
      `history: previous snapshot missing finite ${listingKind}.total_downloads; using first-run net calculation`,
    );
    return null;
  }
  return total;
}

function computeNetDownloads(currentTotal: number, previousTotal: number | null): number {
  return previousTotal === null ? currentTotal : currentTotal - previousTotal;
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
  if (isObject(raw)) {
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

  const listingEntries = index[listingKind];
  if (Array.isArray(listingEntries)) {
    warnings.push(`${sourceLabel} has invalid entries value; using '${listingKind}' array length from index`);
    return listingEntries.length;
  }

  warnings.push(`${sourceLabel} has invalid entries value; using fallback 0`);
  return 0;
}

function normalizeSnapshotDownloadsOrEmpty(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  try {
    return normalizeDownloads(raw, listingKind, warnings, sourceLabel);
  } catch {
    warnings.push(`${sourceLabel} has invalid downloads payload; treating as empty`);
    return {};
  }
}

export function generateDownloadHistorySnapshot(
  options: GenerateDownloadHistoryOptions,
): GenerateDownloadHistoryResult {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const snapshotDate = toSnapshotDate(now);
  const snapshotFileName = `snapshot_${snapshotDate}.json`;
  const previous = readPreviousSnapshot(options.repoRoot, snapshotFileName, warnings);
  const mapsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "maps", warnings);
  const modsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "mods", warnings);

  const mapsData = readListingData(options.repoRoot, "maps", warnings, mapsValidVersions);
  const modsData = readListingData(options.repoRoot, "mods", warnings, modsValidVersions);

  const previousMapsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "maps", warnings);
  const previousModsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "mods", warnings);

  const snapshot: DownloadHistorySnapshot = {
    schema_version: 1,
    snapshot_date: snapshotDate,
    generated_at: now.toISOString(),
    maps: {
      downloads: mapsData.downloads,
      total_downloads: mapsData.totalDownloads,
      net_downloads: computeNetDownloads(mapsData.totalDownloads, previousMapsTotal),
      index: mapsData.index,
      entries: mapsData.entries,
    },
    mods: {
      downloads: modsData.downloads,
      total_downloads: modsData.totalDownloads,
      net_downloads: computeNetDownloads(modsData.totalDownloads, previousModsTotal),
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
  const mapsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "maps", warnings);
  const modsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "mods", warnings);
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

    const mapsRawDownloads = normalizeSnapshotDownloadsOrEmpty(
      snapshot.maps?.downloads,
      "maps",
      warnings,
      `history/${fileName}:maps.downloads`,
    );
    const modsRawDownloads = normalizeSnapshotDownloadsOrEmpty(
      snapshot.mods?.downloads,
      "mods",
      warnings,
      `history/${fileName}:mods.downloads`,
    );

    const mapsDownloads = filterDownloadsByIntegrity(
      mapsRawDownloads,
      mapsValidVersions,
      `history/${fileName}:maps.downloads`,
      warnings,
    );
    const modsDownloads = filterDownloadsByIntegrity(
      modsRawDownloads,
      modsValidVersions,
      `history/${fileName}:mods.downloads`,
      warnings,
    );

    const mapsTotalDownloads = computeTotalDownloads(mapsDownloads);
    const modsTotalDownloads = computeTotalDownloads(modsDownloads);

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
        downloads: mapsDownloads,
        total_downloads: mapsTotalDownloads,
        net_downloads: computeNetDownloads(mapsTotalDownloads, previousSnapshot?.maps.total_downloads ?? null),
        index: mapsIndex,
        entries: mapsEntries,
      },
      mods: {
        downloads: modsDownloads,
        total_downloads: modsTotalDownloads,
        net_downloads: computeNetDownloads(modsTotalDownloads, previousSnapshot?.mods.total_downloads ?? null),
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
