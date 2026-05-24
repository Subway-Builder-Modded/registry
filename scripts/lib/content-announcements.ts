import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { IntegrityOutput } from "./integrity.js";
import type { ManifestType } from "./manifests.js";
import { readJsonFile, sortObjectByKeys, writeJsonFile } from "./json-utils.js";

export interface ContentAnnouncementEntry {
  listing_id: string;
  listing_type: ManifestType;
  latest_semver_version: string | null;
  recorded_at: string;
  source: string;
}

export interface ContentAnnouncementLedger {
  schema_version: 1;
  updated_at: string;
  entries: Record<string, ContentAnnouncementEntry>;
}

function getLedgerPath(repoRoot: string): string {
  return resolve(repoRoot, "history", "content-announcements.json");
}

export function makeContentAnnouncementKey(listingType: ManifestType, listingId: string): string {
  return `${listingType}:${listingId}`;
}

export function createEmptyContentAnnouncementLedger(nowIso = new Date().toISOString()): ContentAnnouncementLedger {
  return {
    schema_version: 1,
    updated_at: nowIso,
    entries: {},
  };
}

export function loadContentAnnouncementLedger(repoRoot: string): ContentAnnouncementLedger {
  const ledgerPath = getLedgerPath(repoRoot);
  if (!existsSync(ledgerPath)) {
    return createEmptyContentAnnouncementLedger();
  }
  try {
    const parsed = readJsonFile<unknown>(ledgerPath);
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || (parsed as { schema_version?: unknown }).schema_version !== 1
    ) {
      return createEmptyContentAnnouncementLedger();
    }
    const updatedAt = typeof (parsed as { updated_at?: unknown }).updated_at === "string"
      ? (parsed as { updated_at: string }).updated_at
      : new Date().toISOString();
    const rawEntries = (parsed as { entries?: unknown }).entries;
    if (typeof rawEntries !== "object" || rawEntries === null || Array.isArray(rawEntries)) {
      return createEmptyContentAnnouncementLedger(updatedAt);
    }

    const entries: Record<string, ContentAnnouncementEntry> = {};
    for (const [key, value] of Object.entries(rawEntries)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      const listingId = (value as { listing_id?: unknown }).listing_id;
      const listingType = (value as { listing_type?: unknown }).listing_type;
      const latestSemverVersion = (value as { latest_semver_version?: unknown }).latest_semver_version;
      const recordedAt = (value as { recorded_at?: unknown }).recorded_at;
      const source = (value as { source?: unknown }).source;
      if (
        typeof listingId !== "string"
        || (listingType !== "map" && listingType !== "mod")
        || (latestSemverVersion !== null && typeof latestSemverVersion !== "string")
        || typeof recordedAt !== "string"
        || typeof source !== "string"
      ) {
        continue;
      }
      entries[key] = {
        listing_id: listingId,
        listing_type: listingType,
        latest_semver_version: latestSemverVersion,
        recorded_at: recordedAt,
        source,
      };
    }

    return {
      schema_version: 1,
      updated_at: updatedAt,
      entries: sortObjectByKeys(entries),
    };
  } catch {
    return createEmptyContentAnnouncementLedger();
  }
}

export function hasContentAnnouncementRecord(
  ledger: ContentAnnouncementLedger,
  listingType: ManifestType,
  listingId: string,
): boolean {
  return Object.hasOwn(ledger.entries, makeContentAnnouncementKey(listingType, listingId));
}

export function recordContentAnnouncements(params: {
  ledger: ContentAnnouncementLedger;
  listingType: ManifestType;
  listingIds: string[];
  integrity: IntegrityOutput;
  recordedAt: string;
  source: string;
}): number {
  const {
    ledger,
    listingType,
    listingIds,
    integrity,
    recordedAt,
    source,
  } = params;

  let added = 0;
  for (const listingId of [...new Set(listingIds)].sort()) {
    const key = makeContentAnnouncementKey(listingType, listingId);
    if (Object.hasOwn(ledger.entries, key)) {
      continue;
    }
    ledger.entries[key] = {
      listing_id: listingId,
      listing_type: listingType,
      latest_semver_version: integrity.listings[listingId]?.latest_semver_version ?? null,
      recorded_at: recordedAt,
      source,
    };
    added += 1;
  }

  ledger.entries = sortObjectByKeys(ledger.entries);
  if (added > 0) {
    ledger.updated_at = recordedAt;
  }
  return added;
}

export function writeContentAnnouncementLedger(
  repoRoot: string,
  ledger: ContentAnnouncementLedger,
): void {
  writeJsonFile(getLedgerPath(repoRoot), {
    schema_version: 1,
    updated_at: ledger.updated_at,
    entries: sortObjectByKeys(ledger.entries),
  });
}
