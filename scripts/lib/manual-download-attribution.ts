import {
  createDownloadAttributionDelta,
  type DownloadAttributionDelta,
  recordDownloadAttributionFetchByAssetKey,
  sumDownloadAttributionDeltaFetches,
} from "./download-attribution.js";
import { isObject, sortObjectByKeys } from "./json-utils.js";

export type ManualDownloadAttributionListingType = "map" | "mod";

export interface ManualDownloadAttributionAssetEntry {
  asset_key: string;
  count: number;
  note?: string;
}

export interface ManualDownloadAttributionVersionEntry {
  listing_type: ManualDownloadAttributionListingType;
  listing_id: string;
  version: string;
  count: number;
  note?: string;
}

export type ManualDownloadAttributionEntry =
  | ManualDownloadAttributionAssetEntry
  | ManualDownloadAttributionVersionEntry;

export interface ManualDownloadAttributionSpec {
  source: string;
  delta_id: string;
  generated_at: string;
  entries: ManualDownloadAttributionEntry[];
}

export interface ManualDownloadAttributionResolvedEntry {
  asset_key: string;
  count: number;
  note?: string;
  source_entry: ManualDownloadAttributionEntry;
}

export interface BuildManualDownloadAttributionResult {
  delta: DownloadAttributionDelta;
  resolved_entries: ManualDownloadAttributionResolvedEntry[];
  total_fetches: number;
}

export interface ResolveManualDownloadAttributionVersionInput {
  listing_type: ManualDownloadAttributionListingType;
  listing_id: string;
  version: string;
}

export type ResolveManualDownloadAttributionVersion = (
  input: ResolveManualDownloadAttributionVersionInput,
) => string;

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return value;
}

function normalizeEntry(
  value: unknown,
  index: number,
): ManualDownloadAttributionEntry {
  if (!isObject(value)) {
    throw new Error(`Expected entries[${index}] to be an object.`);
  }

  const count = requirePositiveInteger(value.count, `entries[${index}].count`);
  const note = typeof value.note === "string" && value.note.trim() !== ""
    ? value.note.trim()
    : undefined;

  if (typeof value.asset_key === "string" && value.asset_key.trim() !== "") {
    return {
      asset_key: value.asset_key.trim(),
      count,
      note,
    };
  }

  const listingType = requireNonEmptyString(
    value.listing_type,
    `entries[${index}].listing_type`,
  );
  if (listingType !== "map" && listingType !== "mod") {
    throw new Error(`Expected entries[${index}].listing_type to be 'map' or 'mod'.`);
  }

  return {
    listing_type: listingType,
    listing_id: requireNonEmptyString(value.listing_id, `entries[${index}].listing_id`),
    version: requireNonEmptyString(value.version, `entries[${index}].version`),
    count,
    note,
  };
}

export function normalizeManualDownloadAttributionSpec(
  value: unknown,
): ManualDownloadAttributionSpec {
  if (!isObject(value)) {
    throw new Error("Expected manual attribution spec to be an object.");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error("Expected spec.entries to be a non-empty array.");
  }

  return {
    source: requireNonEmptyString(value.source, "spec.source"),
    delta_id: requireNonEmptyString(value.delta_id, "spec.delta_id"),
    generated_at: requireNonEmptyString(value.generated_at, "spec.generated_at"),
    entries: value.entries.map((entry, index) => normalizeEntry(entry, index)),
  };
}

function resolveEntryAssetKey(
  entry: ManualDownloadAttributionEntry,
  resolveVersion: ResolveManualDownloadAttributionVersion,
): string {
  if ("asset_key" in entry) {
    return entry.asset_key;
  }
  return resolveVersion({
    listing_type: entry.listing_type,
    listing_id: entry.listing_id,
    version: entry.version,
  });
}

export function buildManualDownloadAttributionDelta(
  spec: ManualDownloadAttributionSpec,
  resolveVersion: ResolveManualDownloadAttributionVersion,
): BuildManualDownloadAttributionResult {
  const delta = createDownloadAttributionDelta(
    spec.source,
    spec.delta_id,
    spec.generated_at,
  );
  const resolvedEntries: ManualDownloadAttributionResolvedEntry[] = [];

  for (const entry of spec.entries) {
    const assetKey = resolveEntryAssetKey(entry, resolveVersion);
    for (let i = 0; i < entry.count; i += 1) {
      recordDownloadAttributionFetchByAssetKey(delta, assetKey);
    }
    resolvedEntries.push({
      asset_key: assetKey,
      count: entry.count,
      note: entry.note,
      source_entry: entry,
    });
  }

  delta.assets = sortObjectByKeys(delta.assets);
  return {
    delta,
    resolved_entries: resolvedEntries,
    total_fetches: sumDownloadAttributionDeltaFetches(delta),
  };
}
