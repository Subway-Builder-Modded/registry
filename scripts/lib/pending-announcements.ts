import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ContentAnnouncementLedger } from "./content-announcements.js";
import { hasContentAnnouncementRecord } from "./content-announcements.js";
import { getDirectoryForType, loadIntegritySnapshot } from "./downloads-support.js";
import type { IntegrityOutput } from "./integrity.js";
import type { ManifestType } from "./manifests.js";
import { isTestListing } from "./test-listings.js";

export interface PendingAnnouncementEntry {
  listing_id: string;
  manifest_path: string;
}

export interface PendingAnnouncementsFile {
  schema_version: 1;
  generated_at: string;
  listing_type: ManifestType;
  listings: PendingAnnouncementEntry[];
}

export interface PendingAnnouncementInputFile {
  requested_path: string;
  absolute_path: string;
  pending: PendingAnnouncementsFile;
}

export function getAnnouncementListingIds(
  newIntegrity: IntegrityOutput,
  previousIntegrity: IntegrityOutput,
): string[] {
  return Object.entries(newIntegrity.listings)
    .filter(([, listing]) => listing.has_complete_version)
    .filter(([id]) => !previousIntegrity.listings[id]?.has_complete_version)
    .map(([id]) => id);
}

export function buildPendingAnnouncements(params: {
  newIntegrity: IntegrityOutput;
  previousIntegrity: IntegrityOutput | null;
  listingType: ManifestType;
  repoRoot: string;
  announcementLedger: ContentAnnouncementLedger;
}): PendingAnnouncementsFile {
  const {
    newIntegrity,
    previousIntegrity,
    listingType,
    repoRoot,
    announcementLedger,
  } = params;
  const previous = previousIntegrity ?? {
    schema_version: 1,
    generated_at: "",
    listings: {},
  };

  const newListings = getAnnouncementListingIds(newIntegrity, previous);
  const listings: PendingAnnouncementEntry[] = [];
  for (const listingId of newListings) {
    if (isTestListing(repoRoot, listingType === "map" ? "maps" : "mods", listingId)) {
      continue;
    }
    if (hasContentAnnouncementRecord(announcementLedger, listingType, listingId)) {
      continue;
    }
    listings.push({
      listing_id: listingId,
      manifest_path: join(
        listingType === "map" ? "maps" : "mods",
        listingId,
        "manifest.json",
      ),
    });
  }

  return {
    schema_version: 1,
    generated_at: newIntegrity.generated_at,
    listing_type: listingType,
    listings,
  };
}

export function readPendingAnnouncementsFile(filePath: string): PendingAnnouncementsFile {
  return JSON.parse(readFileSync(filePath, "utf8")) as PendingAnnouncementsFile;
}

export function parsePendingAnnouncementFileArgs(argv: string[]): string[] {
  const files: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--file") {
      const file = argv[index + 1];
      if (!file || file.startsWith("-")) {
        throw new Error(`Missing file value after '${arg}'`);
      }
      files.push(file.trim());
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'. Supported flags: --file <path>.`);
  }

  if (files.length === 0) {
    throw new Error("Missing pending announcement file path. Use --file <path>.");
  }

  return files;
}

export function loadPendingAnnouncementInputs(
  repoRoot: string,
  files: string[],
  logger: (message: string) => void,
): PendingAnnouncementInputFile[] {
  const inputs: PendingAnnouncementInputFile[] = [];
  for (const file of files) {
    const absolutePath = resolve(repoRoot, file);
    if (!existsSync(absolutePath)) {
      logger(file);
      continue;
    }
    inputs.push({
      requested_path: file,
      absolute_path: absolutePath,
      pending: readPendingAnnouncementsFile(absolutePath),
    });
  }
  return inputs;
}

export function loadCurrentIntegrityForPendingAnnouncement(
  repoRoot: string,
  pending: PendingAnnouncementsFile,
): IntegrityOutput {
  const integrity = loadIntegritySnapshot(repoRoot, getDirectoryForType(pending.listing_type));
  if (!integrity) {
    throw new Error(`Missing integrity snapshot for listing type '${pending.listing_type}'`);
  }
  return integrity;
}
