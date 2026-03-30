import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DownloadsByListing } from "./download-definitions.js";
import {
  loadDownloadAttributionLedger,
  type DownloadAttributionLedger,
} from "./download-attribution.js";
import { getManifest } from "./downloads-support.js";
import type { IntegritySource } from "./integrity.js";
import type { ManifestDirectory } from "./manifests.js";

type ListingKind = "maps" | "mods";
type ValidVersionsByListing = Record<string, Set<string>>;
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
  is_complete?: unknown;
  source?: unknown;
}

interface IntegrityListingLike {
  versions?: unknown;
  complete_versions?: unknown;
}

interface IntegrityOutputLike {
  listings?: unknown;
}

export interface DownloadHistorySnapshot {
  schema_version: 2;
  snapshot_date: string;
  generated_at: string;
  total_downloads: number;
  raw_total_downloads: number;
  total_attributed_downloads: number;
  total_attributed_fetches: number;
  net_downloads: number;
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

export interface NormalizeDownloadHistorySnapshotOptions {
  repoRoot: string;
  snapshot: DownloadHistorySnapshot;
  previousSnapshot: DownloadHistorySnapshot | null;
  warnings: string[];
  fileName: string;
}

const SNAPSHOT_PATTERN = /^snapshot_(\d{4}_\d{2}_\d{2})\.json$/;
const DOWNLOAD_HISTORY_SCHEMA_VERSION = 2;
const ATTRIBUTION_ADJUSTED_SNAPSHOT_START_DATE = "2026_03_30";

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

function normalizeIntegritySource(
  raw: unknown,
): IntegritySource | null {
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
          `${listingKind}/integrity.json: listing='${listingId}' version='${version}' has invalid source metadata; falling back to manifest inference`,
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

function sumLedgerTotalUpToDate(ledger: DownloadAttributionLedger, snapshotDate: string): number {
  let total = 0;
  for (const [dateKey, entry] of Object.entries(ledger.daily)) {
    if (dateKey > snapshotDate) continue;
    if (typeof entry.total === "number" && Number.isFinite(entry.total)) {
      total += entry.total;
      continue;
    }
    total += Object.values(entry.assets).reduce((sum, value) => sum + value, 0);
  }
  return total;
}

function cloneDownloads(downloads: DownloadsByListing): DownloadsByListing {
  const clone: DownloadsByListing = {};
  for (const listingId of Object.keys(downloads).sort()) {
    clone[listingId] = { ...(downloads[listingId] ?? {}) };
  }
  return clone;
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

function subtractDownloads(raw: DownloadsByListing, attributed: DownloadsByListing): DownloadsByListing {
  const adjusted: DownloadsByListing = {};
  const listingIds = new Set<string>([...Object.keys(raw), ...Object.keys(attributed)]);
  for (const listingId of [...listingIds].sort()) {
    const versions = new Set<string>([
      ...Object.keys(raw[listingId] ?? {}),
      ...Object.keys(attributed[listingId] ?? {}),
    ]);
    const adjustedVersions: Record<string, number> = {};
    for (const version of [...versions].sort()) {
      const rawCount = raw[listingId]?.[version] ?? 0;
      const attributedCount = attributed[listingId]?.[version] ?? 0;
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
    const versions = new Set<string>([
      ...Object.keys(raw[listingId] ?? {}),
      ...Object.keys(attributed[listingId] ?? {}),
    ]);
    const cappedVersions: Record<string, number> = {};
    for (const version of [...versions].sort()) {
      const rawCount = raw[listingId]?.[version] ?? 0;
      const attributedCount = attributed[listingId]?.[version] ?? 0;
      const cappedCount = Math.min(rawCount, attributedCount);
      if (cappedCount !== attributedCount) {
        warnings.push(
          `${sourceLabel}: listing='${listingId}' version='${version}' attributed downloads exceeded stored raw downloads (${attributedCount} > ${rawCount}); capping attribution to raw count`,
        );
      }
      cappedVersions[version] = cappedCount;
    }
    capped[listingId] = cappedVersions;
  }
  return capped;
}

function parseAttributionAssetKey(assetKey: string): { repo: string; tag: string; assetName: string } | null {
  const slashIndex = assetKey.lastIndexOf("/");
  if (slashIndex <= 0) return null;
  const repoAndTag = assetKey.slice(0, slashIndex);
  const assetName = assetKey.slice(slashIndex + 1);
  const atIndex = repoAndTag.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === repoAndTag.length - 1 || assetName.trim() === "") return null;
  return {
    repo: repoAndTag.slice(0, atIndex).toLowerCase(),
    tag: repoAndTag.slice(atIndex + 1),
    assetName,
  };
}

function parseCustomUpdateRepo(updateUrl: string): string | null {
  try {
    const parsed = new URL(updateUrl);
    if (parsed.hostname === "raw.githubusercontent.com") {
      const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`.toLowerCase();
      }
    }
    if (parsed.hostname.endsWith(".github.io")) {
      const owner = parsed.hostname.slice(0, -".github.io".length);
      const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
      if (owner !== "" && segments.length >= 1) {
        return `${owner}/${segments[0]}`.toLowerCase();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeTagForMatching(tag: string): string {
  const lowered = tag.trim().toLowerCase();
  return lowered.startsWith("v") ? lowered.slice(1) : lowered;
}

function inferAssetMatcherTokenFromManifest(
  listingKind: ListingKind,
  manifest: Record<string, unknown>,
  updateUrl?: string,
): string | null {
  if (listingKind === "maps") {
    const cityCode = typeof manifest.city_code === "string" ? manifest.city_code.trim() : "";
    if (cityCode !== "") return cityCode.toLowerCase();
  }

  if (!updateUrl) {
    return null;
  }

  try {
    const parsed = new URL(updateUrl);
    const baseName = parsed.pathname.split("/").pop() ?? "";
    const normalized = baseName
      .replace(/\.json$/i, "")
      .replace(/^update[-_]?/i, "")
      .replace(/[-_]?update$/i, "")
      .trim()
      .toLowerCase();
    return normalized !== "" ? normalized : null;
  } catch {
    return null;
  }
}

function assetMatchesToken(assetName: string, token: string | null): boolean {
  if (!assetName.toLowerCase().endsWith(".zip")) return false;
  if (!token) return true;
  const normalizedAsset = assetName.toLowerCase().replace(/\.zip$/i, "");
  return normalizedAsset === token
    || normalizedAsset.startsWith(`${token}_`)
    || normalizedAsset.startsWith(`${token}-`)
    || normalizedAsset.startsWith(token)
    || normalizedAsset.includes(`-${token}`)
    || normalizedAsset.includes(`_${token}`)
    || normalizedAsset.includes(token);
}

function sumAttributedForIntegritySource(
  ledger: DownloadAttributionLedger,
  source: IntegritySource,
  snapshotDate: string,
): number {
  const repo = source.repo?.trim().toLowerCase();
  const tag = source.tag?.trim();
  const assetName = source.asset_name?.trim();
  if (!repo || !tag || !assetName) return 0;

  let total = 0;
  for (const [dateKey, entry] of Object.entries(ledger.daily)) {
    if (dateKey > snapshotDate) continue;
    for (const [assetKey, count] of Object.entries(entry.assets)) {
      const parsed = parseAttributionAssetKey(assetKey);
      if (!parsed) continue;
      if (parsed.repo !== repo) continue;
      if (parsed.tag !== tag) continue;
      if (parsed.assetName !== assetName) continue;
      total += count;
    }
  }
  return total;
}

function sumAttributedForVersion(
  ledger: DownloadAttributionLedger,
  listingKind: ListingKind,
  listingId: string,
  version: string,
  snapshotDate: string,
  repoRoot: string,
  exactSource?: IntegritySource | null,
): number {
  if (exactSource) {
    return sumAttributedForIntegritySource(ledger, exactSource, snapshotDate);
  }

  const dir: ManifestDirectory = listingKind;
  let manifest: Record<string, unknown>;
  try {
    manifest = getManifest(repoRoot, dir, listingId) as unknown as Record<string, unknown>;
  } catch {
    return 0;
  }

  const update = manifest.update;
  if (typeof update !== "object" || update === null || Array.isArray(update)) {
    return 0;
  }

  let repo: string | null = null;
  let assetMatcherToken: string | null = null;
  const updateType = (update as { type?: unknown }).type;
  if (updateType === "github") {
    const updateRepo = (update as { repo?: unknown }).repo;
    if (typeof updateRepo === "string" && updateRepo.trim() !== "") {
      repo = updateRepo.trim().toLowerCase();
      assetMatcherToken = inferAssetMatcherTokenFromManifest(listingKind, manifest);
    }
  } else if (updateType === "custom") {
    const updateUrl = (update as { url?: unknown }).url;
    if (typeof updateUrl === "string" && updateUrl.trim() !== "") {
      repo = parseCustomUpdateRepo(updateUrl);
      assetMatcherToken = inferAssetMatcherTokenFromManifest(listingKind, manifest, updateUrl);
    }
  }

  if (!repo) return 0;

  const normalizedVersion = normalizeTagForMatching(version);
  let total = 0;
  for (const [dateKey, entry] of Object.entries(ledger.daily)) {
    if (dateKey > snapshotDate) continue;
    for (const [assetKey, count] of Object.entries(entry.assets)) {
      const parsed = parseAttributionAssetKey(assetKey);
      if (!parsed) continue;
      if (parsed.repo !== repo) continue;
      if (normalizeTagForMatching(parsed.tag) !== normalizedVersion && !normalizeTagForMatching(parsed.tag).includes(normalizedVersion)) {
        continue;
      }
      if (!assetMatchesToken(parsed.assetName, assetMatcherToken)) continue;
      total += count;
    }
  }
  return total;
}

function buildAttributedDownloadsForSnapshot(
  repoRoot: string,
  listingKind: ListingKind,
  downloads: DownloadsByListing,
  snapshotDate: string,
  ledger: DownloadAttributionLedger,
  integritySources: IntegritySourceByListingVersion,
): DownloadsByListing {
  const attributed: DownloadsByListing = {};
  for (const listingId of Object.keys(downloads).sort()) {
    const versions = downloads[listingId] ?? {};
    const attributedVersions: Record<string, number> = {};
    for (const version of Object.keys(versions).sort()) {
      attributedVersions[version] = sumAttributedForVersion(
        ledger,
        listingKind,
        listingId,
        version,
        snapshotDate,
        repoRoot,
        integritySources[listingId]?.[version] ?? null,
      );
    }
    attributed[listingId] = attributedVersions;
  }
  return attributed;
}

function resolveSourceDownloadsMode(
  snapshotDate: string,
  section: DownloadHistorySection | undefined,
): SourceDownloadsMode {
  const existing = section?.source_downloads_mode;
  if (existing === "already_adjusted" || existing === "legacy_unadjusted") {
    return existing;
  }
  return snapshotDate >= ATTRIBUTION_ADJUSTED_SNAPSHOT_START_DATE
    ? "already_adjusted"
    : "legacy_unadjusted";
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

function resolveStoredDownloadsForBackfill(
  snapshotDate: string,
  section: DownloadHistorySection | undefined,
  listingKind: ListingKind,
  warnings: string[],
  sourceLabel: string,
): DownloadsByListing {
  const sourceMode = resolveSourceDownloadsMode(snapshotDate, section);
  if (sourceMode === "legacy_unadjusted" && section?.raw_downloads) {
    return normalizeSnapshotDownloadsOrEmpty(
      section.raw_downloads,
      listingKind,
      warnings,
      `${sourceLabel}.raw_downloads`,
    );
  }
  return normalizeSnapshotDownloadsOrEmpty(
    section?.downloads,
    listingKind,
    warnings,
    `${sourceLabel}.downloads`,
  );
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
  const mapsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "maps", warnings);
  const modsValidVersions = readValidVersionsFromIntegrity(options.repoRoot, "mods", warnings);
  const mapsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "maps", warnings);
  const modsIntegritySources = readIntegritySourcesFromIntegrity(options.repoRoot, "mods", warnings);

  const mapsData = readListingData(options.repoRoot, "maps", warnings, mapsValidVersions);
  const modsData = readListingData(options.repoRoot, "mods", warnings, modsValidVersions);
  const mapsAttributedDownloads = buildAttributedDownloadsForSnapshot(
    options.repoRoot,
    "maps",
    mapsData.downloads,
    snapshotDate,
    attributionLedger,
    mapsIntegritySources,
  );
  const modsAttributedDownloads = buildAttributedDownloadsForSnapshot(
    options.repoRoot,
    "mods",
    modsData.downloads,
    snapshotDate,
    attributionLedger,
    modsIntegritySources,
  );
  const mapsRawDownloads = addDownloads(mapsData.downloads, mapsAttributedDownloads);
  const modsRawDownloads = addDownloads(modsData.downloads, modsAttributedDownloads);
  const mapsAttributedTotal = computeTotalDownloads(mapsAttributedDownloads);
  const modsAttributedTotal = computeTotalDownloads(modsAttributedDownloads);
  const totalAttributedFetches = sumLedgerTotalUpToDate(attributionLedger, snapshotDate);

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
  const attributionLedger = loadDownloadAttributionLedger(options.repoRoot);
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
    const normalizedSnapshot = normalizeDownloadHistorySnapshot({
      repoRoot: options.repoRoot,
      snapshot,
      previousSnapshot,
      warnings,
      fileName,
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
  const { repoRoot, snapshot, previousSnapshot, warnings, fileName } = options;
  const attributionLedger = loadDownloadAttributionLedger(repoRoot);
  const mapsValidVersions = readValidVersionsFromIntegrity(repoRoot, "maps", warnings);
  const modsValidVersions = readValidVersionsFromIntegrity(repoRoot, "mods", warnings);
  const mapsIntegritySources = readIntegritySourcesFromIntegrity(repoRoot, "maps", warnings);
  const modsIntegritySources = readIntegritySourcesFromIntegrity(repoRoot, "mods", warnings);

  const mapsStoredDownloads = resolveStoredDownloadsForBackfill(
    snapshot.snapshot_date,
    snapshot.maps,
    "maps",
    warnings,
    `history/${fileName}:maps`,
  );
  const modsStoredDownloads = resolveStoredDownloadsForBackfill(
    snapshot.snapshot_date,
    snapshot.mods,
    "mods",
    warnings,
    `history/${fileName}:mods`,
  );
  const mapsAttributionUncapped = buildAttributedDownloadsForSnapshot(
    repoRoot,
    "maps",
    mapsStoredDownloads,
    snapshot.snapshot_date,
    attributionLedger,
    mapsIntegritySources,
  );
  const modsAttributionUncapped = buildAttributedDownloadsForSnapshot(
    repoRoot,
    "mods",
    modsStoredDownloads,
    snapshot.snapshot_date,
    attributionLedger,
    modsIntegritySources,
  );
  const mapsSourceMode = resolveSourceDownloadsMode(snapshot.snapshot_date, snapshot.maps);
  const modsSourceMode = resolveSourceDownloadsMode(snapshot.snapshot_date, snapshot.mods);
  const mapsAttribution = mapsSourceMode === "legacy_unadjusted"
    ? capAttributedDownloadsToRaw(
      mapsStoredDownloads,
      mapsAttributionUncapped,
      warnings,
      `history/${fileName}:maps.attributed_downloads`,
    )
    : mapsAttributionUncapped;
  const modsAttribution = modsSourceMode === "legacy_unadjusted"
    ? capAttributedDownloadsToRaw(
      modsStoredDownloads,
      modsAttributionUncapped,
      warnings,
      `history/${fileName}:mods.attributed_downloads`,
    )
    : modsAttributionUncapped;
  const mapsRawDownloads = mapsSourceMode === "already_adjusted"
    ? addDownloads(mapsStoredDownloads, mapsAttribution)
    : cloneDownloads(mapsStoredDownloads);
  const modsRawDownloads = modsSourceMode === "already_adjusted"
    ? addDownloads(modsStoredDownloads, modsAttribution)
    : cloneDownloads(modsStoredDownloads);
  const mapsAdjustedDownloads = mapsSourceMode === "already_adjusted"
    ? cloneDownloads(mapsStoredDownloads)
    : subtractDownloads(mapsStoredDownloads, mapsAttribution);
  const modsAdjustedDownloads = modsSourceMode === "already_adjusted"
    ? cloneDownloads(modsStoredDownloads)
    : subtractDownloads(modsStoredDownloads, modsAttribution);

  const mapsDownloads = filterDownloadsByIntegrity(
    mapsAdjustedDownloads,
    mapsValidVersions,
    `history/${fileName}:maps.downloads`,
    warnings,
  );
  const modsDownloads = filterDownloadsByIntegrity(
    modsAdjustedDownloads,
    modsValidVersions,
    `history/${fileName}:mods.downloads`,
    warnings,
  );
  const mapsFilteredRawDownloads = filterDownloadsByIntegrity(
    mapsRawDownloads,
    mapsValidVersions,
    `history/${fileName}:maps.raw_downloads`,
    warnings,
  );
  const modsFilteredRawDownloads = filterDownloadsByIntegrity(
    modsRawDownloads,
    modsValidVersions,
    `history/${fileName}:mods.raw_downloads`,
    warnings,
  );
  const mapsFilteredAttribution = filterDownloadsByIntegrity(
    mapsAttribution,
    mapsValidVersions,
    `history/${fileName}:maps.attributed_downloads`,
    warnings,
  );
  const modsFilteredAttribution = filterDownloadsByIntegrity(
    modsAttribution,
    modsValidVersions,
    `history/${fileName}:mods.attributed_downloads`,
    warnings,
  );

  const mapsTotalDownloads = computeTotalDownloads(mapsDownloads);
  const modsTotalDownloads = computeTotalDownloads(modsDownloads);
  const mapsRawTotalDownloads = computeTotalDownloads(mapsFilteredRawDownloads);
  const modsRawTotalDownloads = computeTotalDownloads(modsFilteredRawDownloads);
  const mapsAttributedTotal = computeTotalDownloads(mapsFilteredAttribution);
  const modsAttributedTotal = computeTotalDownloads(modsFilteredAttribution);
  const totalAttributedFetches = sumLedgerTotalUpToDate(attributionLedger, snapshot.snapshot_date);

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
      raw_downloads: mapsFilteredRawDownloads,
      attributed_downloads: mapsFilteredAttribution,
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
      raw_downloads: modsFilteredRawDownloads,
      attributed_downloads: modsFilteredAttribution,
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
