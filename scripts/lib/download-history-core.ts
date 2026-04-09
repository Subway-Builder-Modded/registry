import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadsByListing } from "./download-definitions.js";
import {
  forEachLedgerAssetCountUpToCutoff,
  loadDownloadAttributionLedger,
  sumLedgerTotalUpToCutoff,
  type DownloadAttributionLedger,
} from "./download-attribution.js";
import type { IntegritySource } from "./integrity.js";
import { isObject, toFiniteNumber, readJsonFile, writeJsonFile } from "./json-utils.js";
import { toSnapshotDate, toCanonicalHistoryCutoffIso, getHistoryDir, CANONICAL_HISTORY_CUTOFF_HOUR_UTC } from "./history-utils.js";
import type { DownloadHistorySnapshot } from "@subway-builder-modded/registry-schemas";

export type { DownloadHistorySnapshot } from "@subway-builder-modded/registry-schemas";

type ListingKind = "maps" | "mods";
type IntegritySourceByListingVersion = Record<string, Record<string, IntegritySource | null>>;
type SourceDownloadsMode = "already_adjusted" | "legacy_unadjusted";

interface IndexFile {
  schema_version?: number;
  maps?: unknown;
  mods?: unknown;
  [key: string]: unknown;
}

interface DownloadHistorySection {
  downloads: DownloadsByListing;
  raw_downloads?: DownloadsByListing;
  attributed_downloads?: DownloadsByListing;
  total_downloads: number;
  raw_total_downloads?: number;
  total_attributed_downloads?: number;
  net_downloads: number;
  source_downloads_mode?: SourceDownloadsMode;
  index: IndexFile;
  entries: number;
}

interface IntegrityVersionLike {
  source?: unknown;
}

interface IntegrityListingLike {
  versions?: unknown;
}

interface IntegrityOutputLike {
  listings?: unknown;
}

interface AttributionHistoryLike {
  total_attributed_fetches?: unknown;
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

export interface NormalizeDownloadHistorySnapshotOptions {
  repoRoot: string;
  snapshot: DownloadHistorySnapshot;
  previousSnapshot: DownloadHistorySnapshot | null;
  warnings: string[];
  fileName: string;
  attributionLedger?: DownloadAttributionLedger;
  mapsIntegritySources?: IntegritySourceByListingVersion;
  modsIntegritySources?: IntegritySourceByListingVersion;
}

const SNAPSHOT_PATTERN = /^snapshot_(\d{4}_\d{2}_\d{2})\.json$/;
const DOWNLOAD_HISTORY_SCHEMA_VERSION = 2;

function normalizeDownloads(
  raw: unknown,
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
      const parsed = toFiniteNumber(versionsRaw[version]);
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

function normalizeIntegritySource(raw: unknown): IntegritySource | null {
  if (!isObject(raw)) return null;
  const updateType = raw.update_type;
  if (updateType !== "github" && updateType !== "custom") return null;
  const repo = typeof raw.repo === "string" && raw.repo.trim() !== "" ? raw.repo.trim().toLowerCase() : undefined;
  const tag = typeof raw.tag === "string" && raw.tag.trim() !== "" ? raw.tag.trim() : undefined;
  const assetName = typeof raw.asset_name === "string" && raw.asset_name.trim() !== "" ? raw.asset_name.trim() : undefined;
  const downloadUrl = typeof raw.download_url === "string" && raw.download_url.trim() !== ""
    ? raw.download_url.trim()
    : undefined;
  if (!repo || !tag || !assetName) return null;
  return {
    update_type: updateType,
    repo,
    tag,
    asset_name: assetName,
    download_url: downloadUrl,
  };
}

function normalizeIntegritySourcesFromIntegrity(
  raw: unknown,
  listingKind: ListingKind,
  warnings: string[],
): IntegritySourceByListingVersion {
  if (!isObject(raw)) {
    throw new Error(`${listingKind}/integrity.json must be a JSON object`);
  }

  const listings = (raw as IntegrityOutputLike).listings;
  if (!isObject(listings)) {
    throw new Error(`${listingKind}/integrity.json must include an object 'listings' field`);
  }

  const sourcesByListingVersion: IntegritySourceByListingVersion = {};
  for (const listingId of Object.keys(listings).sort()) {
    const listingRaw = listings[listingId];
    if (!isObject(listingRaw)) {
      sourcesByListingVersion[listingId] = {};
      continue;
    }

    const versionsRaw = (listingRaw as IntegrityListingLike).versions;
    if (!isObject(versionsRaw)) {
      sourcesByListingVersion[listingId] = {};
      continue;
    }

    const listingSources: Record<string, IntegritySource | null> = {};
    for (const version of Object.keys(versionsRaw).sort()) {
      const versionRaw = versionsRaw[version];
      if (!isObject(versionRaw)) {
        listingSources[version] = null;
        continue;
      }
      const normalizedSource = normalizeIntegritySource((versionRaw as IntegrityVersionLike).source);
      if ((versionRaw as IntegrityVersionLike).source && !normalizedSource) {
        warnings.push(
          `${listingKind}/integrity.json: listing='${listingId}' version='${version}' has invalid source metadata; strict attribution matching skipped for this version`,
        );
      }
      listingSources[version] = normalizedSource;
    }
    sourcesByListingVersion[listingId] = listingSources;
  }

  return sourcesByListingVersion;
}

function readIntegritySourcesFromIntegrity(
  repoRoot: string,
  listingKind: ListingKind,
  warnings: string[],
): IntegritySourceByListingVersion {
  const integrityPath = resolve(repoRoot, listingKind, "integrity.json");
  if (!existsSync(integrityPath)) {
    throw new Error(`${listingKind}/integrity.json is required to generate download history`);
  }

  return normalizeIntegritySourcesFromIntegrity(
    readJsonFile<unknown>(integrityPath),
    listingKind,
    warnings,
  );
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

function subtractDownloadsWithClamp(
  raw: DownloadsByListing,
  attributed: DownloadsByListing,
): DownloadsByListing {
  const adjusted: DownloadsByListing = {};
  const listingIds = new Set<string>([...Object.keys(raw), ...Object.keys(attributed)]);
  for (const listingId of [...listingIds].sort()) {
    const rawVersions = raw[listingId] ?? {};
    const attributedVersions = attributed[listingId] ?? {};
    const versions = new Set<string>([...Object.keys(rawVersions), ...Object.keys(attributedVersions)]);
    const adjustedVersions: Record<string, number> = {};
    for (const version of [...versions].sort()) {
      const rawCount = rawVersions[version] ?? 0;
      const attributedCount = attributedVersions[version] ?? 0;
      adjustedVersions[version] = Math.max(0, rawCount - attributedCount);
    }
    adjusted[listingId] = adjustedVersions;
  }
  return adjusted;
}

function capAttributedDownloadsToRaw(
  raw: DownloadsByListing,
  attributed: DownloadsByListing,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  const capped: DownloadsByListing = {};
  const listingIds = new Set<string>([...Object.keys(raw), ...Object.keys(attributed)]);
  for (const listingId of [...listingIds].sort()) {
    const rawVersions = raw[listingId] ?? {};
    const attributedVersions = attributed[listingId] ?? {};
    const versions = new Set<string>([...Object.keys(rawVersions), ...Object.keys(attributedVersions)]);
    const cappedVersions: Record<string, number> = {};
    for (const version of [...versions].sort()) {
      const rawCount = rawVersions[version] ?? 0;
      const attributedCount = attributedVersions[version] ?? 0;
      const cappedCount = Math.min(rawCount, attributedCount);
      if (cappedCount !== attributedCount) {
        warnings.push(
          `${sourceLabel}: listing='${listingId}' version='${version}' attributed downloads exceeded raw downloads (${attributedCount} > ${rawCount}); capping`,
        );
      }
      cappedVersions[version] = cappedCount;
    }
    capped[listingId] = cappedVersions;
  }
  return capped;
}

function addDownloads(a: DownloadsByListing, b: DownloadsByListing): DownloadsByListing {
  const merged: DownloadsByListing = {};
  const listingIds = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const listingId of [...listingIds].sort()) {
    const versions = new Set<string>([
      ...Object.keys(a[listingId] ?? {}),
      ...Object.keys(b[listingId] ?? {}),
    ]);
    const mergedVersions: Record<string, number> = {};
    for (const version of [...versions].sort()) {
      mergedVersions[version] = (a[listingId]?.[version] ?? 0) + (b[listingId]?.[version] ?? 0);
    }
    merged[listingId] = mergedVersions;
  }
  return merged;
}

function parseAttributionAssetKey(assetKey: string): { repo: string; tag: string; assetName: string } | null {
  const slashIndex = assetKey.lastIndexOf("/");
  if (slashIndex <= 0) return null;
  const repoAndTag = assetKey.slice(0, slashIndex);
  const rawAssetName = assetKey.slice(slashIndex + 1);
  const hashIndex = rawAssetName.indexOf("#");
  const assetName = hashIndex >= 0 ? rawAssetName.slice(0, hashIndex) : rawAssetName;
  const atIndex = repoAndTag.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === repoAndTag.length - 1 || assetName.trim() === "") return null;
  return {
    repo: repoAndTag.slice(0, atIndex).toLowerCase(),
    tag: repoAndTag.slice(atIndex + 1),
    assetName,
  };
}

function sumAttributedForIntegritySource(
  ledger: DownloadAttributionLedger,
  source: IntegritySource,
  snapshotDate: string,
  cutoffIso: string,
): number {
  const repo = source.repo?.trim().toLowerCase();
  const tag = source.tag?.trim();
  const assetName = source.asset_name?.trim().toLowerCase();
  if (!repo || !tag || !assetName) return 0;

  let total = 0;
  forEachLedgerAssetCountUpToCutoff(ledger, snapshotDate, cutoffIso, (assetKey, count) => {
    const parsed = parseAttributionAssetKey(assetKey);
    if (!parsed) return;
    if (parsed.repo !== repo) return;
    if (parsed.tag !== tag) return;
    if (parsed.assetName.toLowerCase() !== assetName) return;
    total += count;
  });
  return total;
}

function buildAttributedDownloadsForSnapshot(
  downloads: DownloadsByListing,
  snapshotDate: string,
  cutoffIso: string,
  ledger: DownloadAttributionLedger,
  integritySources: IntegritySourceByListingVersion,
): DownloadsByListing {
  const attributed: DownloadsByListing = {};
  for (const listingId of Object.keys(downloads).sort()) {
    const versions = downloads[listingId] ?? {};
    const attributedVersions: Record<string, number> = {};
    for (const version of Object.keys(versions).sort()) {
      const source = integritySources[listingId]?.[version] ?? null;
      attributedVersions[version] = source
        ? sumAttributedForIntegritySource(ledger, source, snapshotDate, cutoffIso)
        : 0;
    }
    attributed[listingId] = attributedVersions;
  }
  return attributed;
}

function readListingData(
  repoRoot: string,
  listingKind: ListingKind,
  warnings: string[],
): { downloads: DownloadsByListing; totalDownloads: number; index: IndexFile; entries: number } {
  const downloadsPath = resolve(repoRoot, listingKind, "downloads.json");
  const indexPath = resolve(repoRoot, listingKind, "index.json");
  const downloadsRaw = readJsonFile<unknown>(downloadsPath);
  const downloads = normalizeDownloads(
    downloadsRaw,
    warnings,
    `${listingKind}/downloads.json`,
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
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  try {
    return normalizeDownloads(raw, warnings, sourceLabel);
  } catch {
    warnings.push(`${sourceLabel} has invalid downloads payload; treating as empty`);
    return {};
  }
}

function resolveStoredRawDownloadsForBackfill(
  section: DownloadHistorySection | undefined,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  if (section?.raw_downloads) {
    return normalizeSnapshotDownloadsOrEmpty(
      section.raw_downloads,
      warnings,
      `${sourceLabel}.raw_downloads`,
    );
  }

  const fallbackRaw = normalizeSnapshotDownloadsOrEmpty(
    section?.downloads,
    warnings,
    `${sourceLabel}.downloads`,
  );
  warnings.push(`${sourceLabel}: missing raw_downloads; using downloads as canonical raw baseline`);
  return fallbackRaw;
}

function resolveSourceDownloadsMode(
  raw: unknown,
  section: DownloadHistorySection | undefined,
  warnings: string[],
  sourceLabel: string,
): SourceDownloadsMode {
  if (raw === "already_adjusted" || raw === "legacy_unadjusted") {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    warnings.push(
      `${sourceLabel} has invalid source_downloads_mode='${raw}'; inferring mode from raw_downloads presence`,
    );
  }
  return section?.raw_downloads ? "already_adjusted" : "legacy_unadjusted";
}

function readAttributionHistoryTotal(
  repoRoot: string,
  snapshotDate: string,
): number | null {
  const filePath = resolve(repoRoot, "history", `download_attribution_${snapshotDate}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = readJsonFile<AttributionHistoryLike>(filePath);
    const total = toFiniteNumber(parsed.total_attributed_fetches);
    return total === null ? null : total;
  } catch {
    return null;
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
  const attributionLedger = loadDownloadAttributionLedger(options.repoRoot);
  const mapsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "maps", warnings);
  const modsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "mods", warnings);

  const mapsData = readListingData(options.repoRoot, "maps", warnings);
  const modsData = readListingData(options.repoRoot, "mods", warnings);
  const mapsAttributedDownloads = buildAttributedDownloadsForSnapshot(
    mapsData.downloads,
    snapshotDate,
    now.toISOString(),
    attributionLedger,
    mapsIntegritySources,
  );
  const modsAttributedDownloads = buildAttributedDownloadsForSnapshot(
    modsData.downloads,
    snapshotDate,
    now.toISOString(),
    attributionLedger,
    modsIntegritySources,
  );
  const mapsRawDownloads = addDownloads(mapsData.downloads, mapsAttributedDownloads);
  const modsRawDownloads = addDownloads(modsData.downloads, modsAttributedDownloads);
  const mapsAttributedTotal = computeTotalDownloads(mapsAttributedDownloads);
  const modsAttributedTotal = computeTotalDownloads(modsAttributedDownloads);
  const totalAttributedFetches = sumLedgerTotalUpToCutoff(attributionLedger, snapshotDate, now.toISOString());

  const previousMapsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "maps", warnings);
  const previousModsTotal = resolvePreviousTotal(previous?.snapshot ?? null, "mods", warnings);

  const snapshot: DownloadHistorySnapshot = {
    schema_version: DOWNLOAD_HISTORY_SCHEMA_VERSION,
    snapshot_date: snapshotDate,
    generated_at: now.toISOString(),
    total_downloads: mapsData.totalDownloads + modsData.totalDownloads,
    raw_total_downloads: (mapsData.totalDownloads + mapsAttributedTotal) + (modsData.totalDownloads + modsAttributedTotal),
    total_attributed_downloads: mapsAttributedTotal + modsAttributedTotal,
    total_attributed_fetches: totalAttributedFetches,
    net_downloads: computeNetDownloads(
      mapsData.totalDownloads + modsData.totalDownloads,
      previousMapsTotal === null || previousModsTotal === null
        ? null
        : previousMapsTotal + previousModsTotal,
    ),
    maps: {
      downloads: mapsData.downloads,
      raw_downloads: mapsRawDownloads,
      attributed_downloads: mapsAttributedDownloads,
      total_downloads: mapsData.totalDownloads,
      raw_total_downloads: mapsData.totalDownloads + mapsAttributedTotal,
      total_attributed_downloads: mapsAttributedTotal,
      net_downloads: computeNetDownloads(mapsData.totalDownloads, previousMapsTotal),
      source_downloads_mode: "already_adjusted",
      index: mapsData.index,
      entries: mapsData.entries,
    },
    mods: {
      downloads: modsData.downloads,
      raw_downloads: modsRawDownloads,
      attributed_downloads: modsAttributedDownloads,
      total_downloads: modsData.totalDownloads,
      raw_total_downloads: modsData.totalDownloads + modsAttributedTotal,
      total_attributed_downloads: modsAttributedTotal,
      net_downloads: computeNetDownloads(modsData.totalDownloads, previousModsTotal),
      source_downloads_mode: "already_adjusted",
      index: modsData.index,
      entries: modsData.entries,
    },
  };

  const historyDir = getHistoryDir(options.repoRoot);
  mkdirSync(historyDir, { recursive: true });
  const snapshotPath = resolve(historyDir, snapshotFileName);
  writeJsonFile(snapshotPath, snapshot);

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
  const attributionLedger = loadDownloadAttributionLedger(options.repoRoot);
  const mapsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "maps", warnings);
  const modsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "mods", warnings);
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
    const normalizedSnapshot = normalizeDownloadHistorySnapshot({
      repoRoot: options.repoRoot,
      snapshot,
      previousSnapshot,
      warnings,
      fileName,
      attributionLedger,
      mapsIntegritySources,
      modsIntegritySources,
    });

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

export function normalizeDownloadHistorySnapshot(
  options: NormalizeDownloadHistorySnapshotOptions,
): DownloadHistorySnapshot {
  const {
    repoRoot,
    snapshot,
    previousSnapshot,
    warnings,
    fileName,
    attributionLedger = loadDownloadAttributionLedger(repoRoot),
    mapsIntegritySources = readIntegritySourcesFromIntegrity(repoRoot, "maps", warnings),
    modsIntegritySources = readIntegritySourcesFromIntegrity(repoRoot, "mods", warnings),
  } = options;
  const cutoffIso = toCanonicalHistoryCutoffIso(snapshot.snapshot_date);

  const mapsSourceMode = resolveSourceDownloadsMode(
    snapshot.maps?.source_downloads_mode,
    snapshot.maps,
    warnings,
    `history/${fileName}:maps.source_downloads_mode`,
  );
  const modsSourceMode = resolveSourceDownloadsMode(
    snapshot.mods?.source_downloads_mode,
    snapshot.mods,
    warnings,
    `history/${fileName}:mods.source_downloads_mode`,
  );

  const mapsStoredRawDownloads = resolveStoredRawDownloadsForBackfill(
    snapshot.maps,
    warnings,
    `history/${fileName}:maps`,
  );
  const modsStoredRawDownloads = resolveStoredRawDownloadsForBackfill(
    snapshot.mods,
    warnings,
    `history/${fileName}:mods`,
  );
  const mapsAttributionUncapped = buildAttributedDownloadsForSnapshot(
    mapsStoredRawDownloads,
    snapshot.snapshot_date,
    cutoffIso,
    attributionLedger,
    mapsIntegritySources,
  );
  const modsAttributionUncapped = buildAttributedDownloadsForSnapshot(
    modsStoredRawDownloads,
    snapshot.snapshot_date,
    cutoffIso,
    attributionLedger,
    modsIntegritySources,
  );
  const mapsAttribution = capAttributedDownloadsToRaw(
    mapsStoredRawDownloads,
    mapsAttributionUncapped,
    warnings,
    `history/${fileName}:maps.attributed_downloads`,
  );
  const modsAttribution = capAttributedDownloadsToRaw(
    modsStoredRawDownloads,
    modsAttributionUncapped,
    warnings,
    `history/${fileName}:mods.attributed_downloads`,
  );
  const mapsDownloads = subtractDownloadsWithClamp(
    mapsStoredRawDownloads,
    mapsAttribution,
  );
  const modsDownloads = subtractDownloadsWithClamp(
    modsStoredRawDownloads,
    modsAttribution,
  );

  const mapsTotalDownloads = computeTotalDownloads(mapsDownloads);
  const modsTotalDownloads = computeTotalDownloads(modsDownloads);
  const mapsRawTotalDownloads = computeTotalDownloads(mapsStoredRawDownloads);
  const modsRawTotalDownloads = computeTotalDownloads(modsStoredRawDownloads);
  const mapsAttributedTotal = computeTotalDownloads(mapsAttribution);
  const modsAttributedTotal = computeTotalDownloads(modsAttribution);
  const totalAttributedFetches = (
    readAttributionHistoryTotal(repoRoot, snapshot.snapshot_date)
    ?? sumLedgerTotalUpToCutoff(attributionLedger, snapshot.snapshot_date, cutoffIso)
  );

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

  return {
    schema_version: DOWNLOAD_HISTORY_SCHEMA_VERSION,
    snapshot_date: snapshot.snapshot_date,
    generated_at: snapshot.generated_at,
    total_downloads: mapsTotalDownloads + modsTotalDownloads,
    raw_total_downloads: mapsRawTotalDownloads + modsRawTotalDownloads,
    total_attributed_downloads: mapsAttributedTotal + modsAttributedTotal,
    total_attributed_fetches: totalAttributedFetches,
    net_downloads: computeNetDownloads(
      mapsTotalDownloads + modsTotalDownloads,
      previousSnapshot === null
        ? null
        : previousSnapshot.total_downloads,
    ),
    maps: {
      downloads: mapsDownloads,
      raw_downloads: mapsStoredRawDownloads,
      attributed_downloads: mapsAttribution,
      total_downloads: mapsTotalDownloads,
      raw_total_downloads: mapsRawTotalDownloads,
      total_attributed_downloads: mapsAttributedTotal,
      net_downloads: computeNetDownloads(mapsTotalDownloads, previousSnapshot?.maps.total_downloads ?? null),
      source_downloads_mode: mapsSourceMode,
      index: mapsIndex,
      entries: mapsEntries,
    },
    mods: {
      downloads: modsDownloads,
      raw_downloads: modsStoredRawDownloads,
      attributed_downloads: modsAttribution,
      total_downloads: modsTotalDownloads,
      raw_total_downloads: modsRawTotalDownloads,
      total_attributed_downloads: modsAttributedTotal,
      net_downloads: computeNetDownloads(modsTotalDownloads, previousSnapshot?.mods.total_downloads ?? null),
      source_downloads_mode: modsSourceMode,
      index: modsIndex,
      entries: modsEntries,
    },
  };
}
