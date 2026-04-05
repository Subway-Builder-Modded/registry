import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestType } from "./manifests.js";
import type { DownloadVersionBucketInput, DownloadsByListing, VersionBucketInputsByListing } from "./download-definitions.js";

const DOWNLOAD_VERSION_BUCKETS_SCHEMA_VERSION = 1;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sortObjectByKeys<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

function isSyntheticBucketKey(bucketKey: string): boolean {
  return bucketKey.startsWith("legacy:")
    || bucketKey.startsWith("history-max:")
    || bucketKey.startsWith("version:");
}

function bucketLogicalKey(bucketKey: string): string {
  const hashIndex = bucketKey.indexOf("#");
  return hashIndex >= 0 ? bucketKey.slice(0, hashIndex) : bucketKey;
}

function hasCanonicalBucketKey(buckets: Record<string, DownloadVersionBucketEntry>): boolean {
  return Object.keys(buckets).some((bucketKey) => !isSyntheticBucketKey(bucketKey));
}

function filterSyntheticBuckets(
  buckets: Record<string, DownloadVersionBucketEntry>,
): Record<string, DownloadVersionBucketEntry> {
  const filtered: Record<string, DownloadVersionBucketEntry> = {};
  for (const [bucketKey, bucket] of Object.entries(buckets)) {
    if (isSyntheticBucketKey(bucketKey)) continue;
    filtered[bucketKey] = bucket;
  }
  return filtered;
}

function computeMaxTotalFromBuckets(
  buckets: Record<string, DownloadVersionBucketEntry>,
): number {
  const perLogicalKeyMax: Record<string, number> = {};
  for (const [bucketKey, bucket] of Object.entries(buckets)) {
    const logicalKey = bucketLogicalKey(bucketKey);
    perLogicalKeyMax[logicalKey] = Math.max(
      perLogicalKeyMax[logicalKey] ?? 0,
      bucket.max_adjusted_downloads,
    );
  }
  return Object.values(perLogicalKeyMax).reduce((sum, count) => sum + count, 0);
}

export interface DownloadVersionBucketEntry {
  max_adjusted_downloads: number;
  last_adjusted_downloads: number;
  updated_at: string;
}

export interface DownloadVersionEntry {
  max_total_downloads: number;
  buckets: Record<string, DownloadVersionBucketEntry>;
  updated_at: string;
}

export interface DownloadVersionListingEntry {
  versions: Record<string, DownloadVersionEntry>;
}

export interface DownloadVersionBucketLedger {
  schema_version: 1;
  updated_at: string;
  listings: Record<string, DownloadVersionListingEntry>;
}

export function toDownloadAssetBucketKey(
  repo: string,
  tag: string,
  assetName: string,
  assetNodeId?: string | null,
): string {
  const base = `${repo.toLowerCase()}@${tag}/${assetName}`;
  if (typeof assetNodeId !== "string" || assetNodeId.trim() === "") {
    return base;
  }
  return `${base}#${assetNodeId.trim()}`;
}

export function createEmptyDownloadVersionBucketLedger(
  nowIso = new Date().toISOString(),
): DownloadVersionBucketLedger {
  return {
    schema_version: DOWNLOAD_VERSION_BUCKETS_SCHEMA_VERSION,
    updated_at: nowIso,
    listings: {},
  };
}

export function getDownloadVersionBucketPath(
  repoRoot: string,
  listingType: ManifestType,
): string {
  const dir = listingType === "map" ? "maps" : "mods";
  return resolve(repoRoot, dir, "download-version-buckets.json");
}

function normalizeDownloadVersionBucketEntry(
  value: unknown,
  nowIso: string,
): DownloadVersionBucketEntry | null {
  if (!isObject(value)) return null;
  const maxAdjusted = toFiniteNonNegativeNumber(value.max_adjusted_downloads);
  const lastAdjusted = toFiniteNonNegativeNumber(value.last_adjusted_downloads);
  if (maxAdjusted === null || lastAdjusted === null) return null;
  const updatedAt = typeof value.updated_at === "string" && value.updated_at.trim() !== ""
    ? value.updated_at
    : nowIso;
  return {
    max_adjusted_downloads: maxAdjusted,
    last_adjusted_downloads: lastAdjusted,
    updated_at: updatedAt,
  };
}

function normalizeDownloadVersionEntry(
  value: unknown,
  nowIso: string,
): DownloadVersionEntry | null {
  if (!isObject(value)) return null;
  const rawBuckets = value.buckets;
  if (!isObject(rawBuckets)) return null;
  const buckets: Record<string, DownloadVersionBucketEntry> = {};
  for (const [bucketKey, bucketRaw] of Object.entries(rawBuckets)) {
    const normalized = normalizeDownloadVersionBucketEntry(bucketRaw, nowIso);
    if (!normalized) continue;
    buckets[bucketKey] = normalized;
  }
  const normalizedBuckets = hasCanonicalBucketKey(buckets)
    ? filterSyntheticBuckets(buckets)
    : buckets;

  const maxTotalFromBuckets = computeMaxTotalFromBuckets(normalizedBuckets);
  const storedMaxTotal = toFiniteNonNegativeNumber(value.max_total_downloads);
  const maxTotal = Object.keys(normalizedBuckets).length > 0
    ? maxTotalFromBuckets
    : (storedMaxTotal ?? 0);
  const updatedAt = typeof value.updated_at === "string" && value.updated_at.trim() !== ""
    ? value.updated_at
    : nowIso;

  return {
    max_total_downloads: maxTotal,
    buckets: sortObjectByKeys(normalizedBuckets),
    updated_at: updatedAt,
  };
}

export function normalizeDownloadVersionBucketLedger(
  value: unknown,
  nowIso = new Date().toISOString(),
): DownloadVersionBucketLedger {
  if (!isObject(value) || value.schema_version !== DOWNLOAD_VERSION_BUCKETS_SCHEMA_VERSION) {
    return createEmptyDownloadVersionBucketLedger(nowIso);
  }

  const rawListings = value.listings;
  if (!isObject(rawListings)) {
    return createEmptyDownloadVersionBucketLedger(nowIso);
  }

  const listings: Record<string, DownloadVersionListingEntry> = {};
  for (const [listingId, listingRaw] of Object.entries(rawListings)) {
    if (!isObject(listingRaw) || !isObject(listingRaw.versions)) continue;
    const versions: Record<string, DownloadVersionEntry> = {};
    for (const [version, versionRaw] of Object.entries(listingRaw.versions)) {
      const normalized = normalizeDownloadVersionEntry(versionRaw, nowIso);
      if (!normalized) continue;
      versions[version] = normalized;
    }
    listings[listingId] = { versions: sortObjectByKeys(versions) };
  }

  return {
    schema_version: DOWNLOAD_VERSION_BUCKETS_SCHEMA_VERSION,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    listings: sortObjectByKeys(listings),
  };
}

export function loadDownloadVersionBucketLedger(
  repoRoot: string,
  listingType: ManifestType,
): DownloadVersionBucketLedger {
  const path = getDownloadVersionBucketPath(repoRoot, listingType);
  if (!existsSync(path)) {
    return createEmptyDownloadVersionBucketLedger();
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return normalizeDownloadVersionBucketLedger(raw);
  } catch {
    return createEmptyDownloadVersionBucketLedger();
  }
}

export function writeDownloadVersionBucketLedger(
  repoRoot: string,
  listingType: ManifestType,
  ledger: DownloadVersionBucketLedger,
): void {
  const path = getDownloadVersionBucketPath(repoRoot, listingType);
  const normalized = normalizeDownloadVersionBucketLedger(ledger);
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export function applyVersionBucketMonotonicCounts(
  ledger: DownloadVersionBucketLedger,
  downloads: DownloadsByListing,
  bucketInputs: VersionBucketInputsByListing,
  nowIso = new Date().toISOString(),
): DownloadsByListing {
  const nextLedger = normalizeDownloadVersionBucketLedger(ledger, nowIso);
  const nextDownloads: DownloadsByListing = {};

  for (const listingId of Object.keys(downloads).sort()) {
    const versions = downloads[listingId] ?? {};
    const listingEntry = nextLedger.listings[listingId] ?? { versions: {} };
    const nextVersionEntries: Record<string, DownloadVersionEntry> = { ...listingEntry.versions };
    const nextVersions: Record<string, number> = {};

    for (const version of Object.keys(versions).sort()) {
      const computedValue = toFiniteNonNegativeNumber(versions[version]) ?? 0;
      const inputsRaw = bucketInputs[listingId]?.[version] ?? [];
      const inputs: DownloadVersionBucketInput[] = inputsRaw
        .filter((input) => typeof input.bucketKey === "string" && input.bucketKey.trim() !== "")
        .map((input) => ({
          bucketKey: input.bucketKey.trim(),
          adjustedCount: toFiniteNonNegativeNumber(input.adjustedCount) ?? 0,
        }));

      const previousVersionEntry = nextVersionEntries[version] ?? {
        max_total_downloads: 0,
        buckets: {},
        updated_at: nowIso,
      };
      let nextBuckets: Record<string, DownloadVersionBucketEntry> = {
        ...previousVersionEntry.buckets,
      };

      if (inputs.length > 0) {
        if (hasCanonicalBucketKey({
          ...nextBuckets,
          ...Object.fromEntries(inputs.map((input) => [input.bucketKey, {
            max_adjusted_downloads: input.adjustedCount,
            last_adjusted_downloads: input.adjustedCount,
            updated_at: nowIso,
          }])),
        })) {
          nextBuckets = filterSyntheticBuckets(nextBuckets);
        }
        for (const input of inputs) {
          const previousBucket = nextBuckets[input.bucketKey];
          const previousMax = previousBucket?.max_adjusted_downloads ?? 0;
          nextBuckets[input.bucketKey] = {
            max_adjusted_downloads: Math.max(previousMax, input.adjustedCount),
            last_adjusted_downloads: input.adjustedCount,
            updated_at: nowIso,
          };
        }
      } else {
        const fallbackBucketKey = `version:${listingId}:${version}`;
        const previousBucket = nextBuckets[fallbackBucketKey];
        const previousMax = previousBucket?.max_adjusted_downloads ?? 0;
        nextBuckets[fallbackBucketKey] = {
          max_adjusted_downloads: Math.max(previousMax, computedValue),
          last_adjusted_downloads: computedValue,
          updated_at: nowIso,
        };
      }

      const maxTotal = computeMaxTotalFromBuckets(nextBuckets);
      nextVersionEntries[version] = {
        max_total_downloads: maxTotal,
        buckets: sortObjectByKeys(nextBuckets),
        updated_at: nowIso,
      };
      nextVersions[version] = computedValue;
    }

    nextLedger.listings[listingId] = {
      versions: sortObjectByKeys(nextVersionEntries),
    };
    nextDownloads[listingId] = sortObjectByKeys(nextVersions);
  }

  nextLedger.updated_at = nowIso;
  nextLedger.listings = sortObjectByKeys(nextLedger.listings);

  ledger.schema_version = nextLedger.schema_version;
  ledger.updated_at = nextLedger.updated_at;
  ledger.listings = nextLedger.listings;

  return nextDownloads;
}
