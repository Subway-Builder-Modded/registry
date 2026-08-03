import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ManifestType } from "./manifests.js";
import { GRANDFATHERED_CITY_CODE_DUPLICATES } from "./map-constants.js";

function buildCityCodeMap(repoRoot: string): Map<string, string[]> {
  const indexPath = resolve(repoRoot, "maps", "index.json");
  if (!existsSync(indexPath)) return new Map();

  let mapIds: string[];
  try {
    const index = JSON.parse(readFileSync(indexPath, "utf-8")) as { maps?: string[] };
    mapIds = Array.isArray(index.maps) ? index.maps.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return new Map();
  }

  const cityCodeMap = new Map<string, string[]>();
  for (const mapId of mapIds) {
    try {
      const manifestPath = resolve(repoRoot, "maps", mapId, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { city_code?: string };
      if (typeof manifest.city_code === "string" && manifest.city_code.trim() !== "") {
        const code = manifest.city_code.trim();
        const existing = cityCodeMap.get(code);
        if (existing) {
          existing.push(mapId);
        } else {
          cityCodeMap.set(code, [mapId]);
        }
      }
    } catch {
      // Skip manifests that can't be read or parsed
    }
  }
  return cityCodeMap;
}

export function checkCityCodeUniqueness(params: {
  repoRoot: string;
  cityCode: string;
  currentMapId: string | null;
}): string[] {
  const { repoRoot, cityCode, currentMapId } = params;
  const cityCodeMap = buildCityCodeMap(repoRoot);
  const conflictingIds = (cityCodeMap.get(cityCode) ?? [])
    .filter((id) => id !== currentMapId);

  if (conflictingIds.length === 0) return [];

  const grandfathered = GRANDFATHERED_CITY_CODE_DUPLICATES.get(cityCode);
  if (grandfathered && currentMapId !== null) {
    const allConflictsGrandfathered = conflictingIds.every((id) => grandfathered.has(id));
    if (allConflictsGrandfathered && grandfathered.has(currentMapId)) {
      return [];
    }
  }

  return [
    `**city-code**: \`${cityCode}\` is already used by map \`${conflictingIds[0]}\`. City codes must be unique.`,
  ];
}

function listListingDirs(repoRoot: string, dir: "maps" | "mods"): string[] {
  const fullPath = resolve(repoRoot, dir);
  if (!existsSync(fullPath)) return [];
  return readdirSync(fullPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(fullPath, entry.name, "manifest.json")))
    .map((entry) => entry.name);
}

/**
 * Repo-wide invariant: listing IDs are unique across maps/ and mods/ combined.
 * Publish-time validation (checkCrossTypeIdUniqueness) prevents new collisions;
 * this scan keeps the invariant explicit so bare-ID resolution
 * (resolveListingById) can never be ambiguous. Scans directories containing a
 * manifest.json — the same ground truth regenerate-indexes uses.
 */
export function findCrossTypeIdCollisions(repoRoot: string): string[] {
  const mapIds = new Set(listListingDirs(repoRoot, "maps"));
  return listListingDirs(repoRoot, "mods").filter((id) => mapIds.has(id)).sort();
}

export function checkCrossTypeIdUniqueness(params: {
  repoRoot: string;
  id: string;
  currentType: ManifestType;
}): string[] {
  const { repoRoot, id, currentType } = params;
  const otherDir = currentType === "map" ? "mods" : "maps";
  const otherType = currentType === "map" ? "mod" : "map";
  const otherPath = resolve(repoRoot, otherDir, id);

  if (!existsSync(otherPath)) return [];

  return [
    `**${currentType}-id**: A ${otherType} with ID \`${id}\` already exists. Listing IDs must be unique across maps and mods.`,
  ];
}
