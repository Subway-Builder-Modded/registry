import type { IntegrityVersionEntry, ListingIntegrityEntry } from "./integrity.js";

export const VERSION_REMOVED_ERROR = "version is no longer enumerated upstream (release or update entry deleted)";

// buildRemovedVersionTombstone derives a frozen "removed" entry from the last
// committed entry of a version upstream no longer enumerates. Check artifacts
// (required_checks, matched_files, sizes, security) are dropped — they describe
// artifacts that no longer exist — while identity fields (source, fingerprint,
// released_at, game_version, dependencies) and the last real checked_at are kept.
export function buildRemovedVersionTombstone(previous: IntegrityVersionEntry): IntegrityVersionEntry {
  return {
    is_complete: false,
    errors: [VERSION_REMOVED_ERROR],
    required_checks: {},
    matched_files: {},
    game_version: previous.game_version,
    dependencies: previous.dependencies,
    source: previous.source,
    fingerprint: previous.fingerprint,
    checked_at: previous.checked_at,
    released_at: previous.released_at,
    availability: "removed",
  };
}

// carryForwardRemovedVersions merges tombstones into nextVersions for versions
// present in the previously committed listing but absent from the fresh
// enumeration, returning the carried version keys. Keyed on the committed
// integrity output — not any ledger — so hand-deleting an entry sticks
// (mirrors the frozen-count guard in download-version-buckets). Only versions
// that were previously complete, retired, or already removed are carried;
// previously-broken versions vanish on non-enumeration as before.
export function carryForwardRemovedVersions(
  previousListing: Pick<ListingIntegrityEntry, "versions"> | undefined,
  nextVersions: Record<string, IntegrityVersionEntry>,
): string[] {
  if (!previousListing) return [];
  const carried: string[] = [];
  for (const [version, previous] of Object.entries(previousListing.versions ?? {})) {
    if (nextVersions[version] !== undefined) continue;
    const eligible = previous.is_complete === true
      || previous.availability === "retired"
      || previous.availability === "removed";
    if (!eligible) continue;
    nextVersions[version] = previous.availability === "removed"
      ? previous
      : buildRemovedVersionTombstone(previous);
    carried.push(version);
  }
  return carried;
}
