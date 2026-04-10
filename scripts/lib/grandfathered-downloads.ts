import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestType } from "./manifests.js";
import type { DownloadsByListing } from "./download-definitions.js";
import { isObject, toFiniteNonNegativeNumber, sortObjectByKeys } from "./json-utils.js";

/**
 * Loads frozen download counts for versions that were clamped before being
 * marked incomplete by integrity checks (e.g. manifest-version-mismatch).
 *
 * These counts are preserved indefinitely so that historical download totals
 * remain monotonically non-decreasing across snapshots.
 */
export function loadGrandfatheredDownloads(
  repoRoot: string,
  listingType: ManifestType,
): Record<string, Record<string, number>> {
  const dir = listingType === "map" ? "maps" : "mods";
  const path = resolve(repoRoot, dir, "grandfathered-downloads.json");
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isObject(raw)) return {};
    const result: Record<string, Record<string, number>> = {};
    for (const [listingId, versions] of Object.entries(raw)) {
      if (!isObject(versions)) continue;
      const versionMap: Record<string, number> = {};
      for (const [version, count] of Object.entries(versions as Record<string, unknown>)) {
        const n = toFiniteNonNegativeNumber(count);
        if (n !== null && n > 0) versionMap[version] = n;
      }
      if (Object.keys(versionMap).length > 0) result[listingId] = versionMap;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Merges grandfathered (frozen) download counts into pipeline output.
 * Only fills in versions that the pipeline did not produce (i.e. versions
 * marked incomplete by integrity checks). If the pipeline already produced
 * a count for a version, that count takes precedence.
 */
export function mergeGrandfatheredDownloads(
  downloads: DownloadsByListing,
  grandfathered: Record<string, Record<string, number>>,
): DownloadsByListing {
  if (Object.keys(grandfathered).length === 0) return downloads;
  const merged: DownloadsByListing = {};
  for (const [listingId, versions] of Object.entries(downloads)) {
    merged[listingId] = { ...versions };
  }
  for (const [listingId, versions] of Object.entries(grandfathered)) {
    if (!merged[listingId]) merged[listingId] = {};
    for (const [version, frozenCount] of Object.entries(versions)) {
      if (merged[listingId]![version] === undefined) {
        merged[listingId]![version] = frozenCount;
      }
    }
  }

  // Sort listing IDs and version keys within each listing for stable, readable output
  const sorted: DownloadsByListing = {};
  for (const listingId of Object.keys(merged).sort()) {
    sorted[listingId] = sortObjectByKeys(merged[listingId]!);
  }
  return sorted;
}
