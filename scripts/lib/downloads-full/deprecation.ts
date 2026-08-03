import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ListingIntegrityEntry } from "../integrity.js";
import type { IntegrityAlert } from "../download-definitions.js";

// Deprecation is an OUTPUT overlay, not an integrity rule: the pipeline
// evaluates deprecated listings normally (so download counts keep accruing
// while the upstream repo is reachable, and the integrity CACHE keeps the true
// computed state for clean un-deprecation), but the PUBLISHED integrity.json
// reports the listing with zero installable versions. Existing app versions
// treat that as "no installable versions" and refuse to download; the website
// drops the listing from browse. This never touches INTEGRITY_RULES_VERSION
// and never fights the never-downgrade guard.

export const DEPRECATED_LISTING_ERROR = "listing_deprecated";

/** Value-level check used where a parsed manifest is already in hand. */
export function isManifestDeprecated(manifest: { deprecation?: unknown }): boolean {
  return manifest.deprecation !== undefined;
}

/**
 * Disk-probing predicate mirroring isTestListing, for suppressing warning /
 * alert output about deprecated listings (a deprecated listing whose repo
 * later disappears must not ping authors or maintainers every run).
 */
export function isDeprecatedListing(
  repoRoot: string,
  listingType: "maps" | "mods",
  id: string,
): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, listingType, id, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    return isManifestDeprecated(manifest);
  } catch {
    return false;
  }
}

/**
 * The published view of a deprecated listing: every version reported
 * incomplete (with an explicit marker error appended for human readers),
 * no complete versions, has_complete_version false. All other version data
 * (source, released_at, file_sizes, game_version, ...) is preserved so
 * downstream consumers of those fields keep working.
 */
export function overlayDeprecatedListingEntry(
  entry: ListingIntegrityEntry,
): ListingIntegrityEntry {
  const versions: ListingIntegrityEntry["versions"] = {};
  for (const [version, versionEntry] of Object.entries(entry.versions)) {
    versions[version] = {
      ...versionEntry,
      is_complete: false,
      errors: versionEntry.errors.includes(DEPRECATED_LISTING_ERROR)
        ? versionEntry.errors
        : [...versionEntry.errors, DEPRECATED_LISTING_ERROR],
    };
  }
  return {
    ...entry,
    has_complete_version: false,
    latest_semver_complete: entry.latest_semver_version === null ? null : false,
    complete_versions: [],
    incomplete_versions: Object.keys(versions).sort(),
    versions,
  };
}

/**
 * Applies the overlay in place to the published integrity listings record.
 * Runs centrally at the end of the full pipeline so every code path that
 * produced a listing entry (fresh evaluation, transient-error preservation,
 * repo-unavailable preservation) is covered. Returns the overlaid ids.
 */
export function applyDeprecationOverlay(
  integrityListings: Record<string, ListingIntegrityEntry>,
  isDeprecated: (id: string) => boolean,
): string[] {
  const overlaid: string[] = [];
  for (const id of Object.keys(integrityListings)) {
    if (!isDeprecated(id)) continue;
    integrityListings[id] = overlayDeprecatedListingEntry(integrityListings[id]!);
    overlaid.push(id);
  }
  return overlaid.sort();
}

/** Deprecated listings never alert their author/caretaker. */
export function filterDeprecatedIntegrityAlerts(
  alerts: IntegrityAlert[],
  isDeprecated: (id: string) => boolean,
): IntegrityAlert[] {
  return alerts.filter((alert) => !isDeprecated(alert.listingId));
}
