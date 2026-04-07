import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";
import { writeJsonFile } from "../json-utils.js";
import { CACHE_FILE_NAME, DEMAND_STATS_CACHE_SCHEMA_VERSION, GRID_SCHEMA_VERSION, UNCHANGED_SKIP_WINDOW_MS } from "./constants.js";
import { isObject, parseInitialViewState, readJsonFile } from "./shared.js";
import type { DemandStatsCache, DemandStatsCacheEntry, DemandStatsCacheFile, DemandStats } from "./types.js";

export function getCachePath(repoRoot: string): string {
  return resolve(repoRoot, "maps", CACHE_FILE_NAME);
}

export function getGridPath(repoRoot: string, listingId: string): string {
  return resolve(repoRoot, "maps", listingId, "grid.geojson");
}

export function loadDemandStatsCache(repoRoot: string): DemandStatsCache {
  const cachePath = getCachePath(repoRoot);
  if (!existsSync(cachePath)) {
    return {};
  }
  try {
    const parsed = readJsonFile<unknown>(cachePath);
    if (!isObject(parsed)) return {};
    if (parsed.schema_version !== DEMAND_STATS_CACHE_SCHEMA_VERSION) return {};
    if (!isObject(parsed.listings)) return {};
    const entries: DemandStatsCache = {};
    for (const [id, entry] of Object.entries(parsed.listings)) {
      if (!isObject(entry)) continue;
      const sourceFingerprint = typeof entry.source_fingerprint === "string"
        ? entry.source_fingerprint
        : undefined;
      const lastCheckedAt = typeof entry.last_checked_at === "string"
        ? entry.last_checked_at
        : undefined;
      const cachedInitialViewState = isObject(entry.stats)
        ? parseInitialViewState(entry.stats.initial_view_state)
        : null;
      const stats: DemandStats | undefined = isObject(entry.stats)
        && typeof entry.stats.residents_total === "number"
        && Number.isFinite(entry.stats.residents_total)
        && entry.stats.residents_total >= 0
        && typeof entry.stats.points_count === "number"
        && Number.isFinite(entry.stats.points_count)
        && entry.stats.points_count >= 0
        && typeof entry.stats.population_count === "number"
        && Number.isFinite(entry.stats.population_count)
        && entry.stats.population_count >= 0
        && cachedInitialViewState !== null
        ? {
          residents_total: entry.stats.residents_total,
          points_count: entry.stats.points_count,
          population_count: entry.stats.population_count,
          initial_view_state: cachedInitialViewState,
        }
        : undefined;
      if (!sourceFingerprint || !lastCheckedAt) continue;
      entries[id] = {
        source_fingerprint: sourceFingerprint,
        last_checked_at: lastCheckedAt,
        stats,
        grid: isObject(entry.grid) && typeof entry.grid.schema_version === "number" && Number.isFinite(entry.grid.schema_version)
          ? { schema_version: entry.grid.schema_version }
          : undefined,
      };
    }
    return entries;
  } catch {
    return {};
  }
}

export function writeDemandStatsCache(repoRoot: string, cache: DemandStatsCache): void {
  const sorted: DemandStatsCache = {};
  for (const key of Object.keys(cache).sort()) {
    sorted[key] = cache[key];
  }
  const cacheFile: DemandStatsCacheFile = {
    schema_version: DEMAND_STATS_CACHE_SCHEMA_VERSION,
    listings: sorted,
  };
  writeJsonFile(getCachePath(repoRoot), cacheFile);
}

export function shouldSkipUnchanged(
  repoRoot: string,
  listingId: string,
  cacheEntry: DemandStatsCacheEntry | undefined,
  sourceFingerprint: string,
  now: Date,
  strictFingerprintCache: boolean,
): boolean {
  if (!cacheEntry) return false;
  if (!cacheEntry.stats) return false;
  if (!cacheEntry.grid) return false;
  if (cacheEntry.grid.schema_version !== GRID_SCHEMA_VERSION) return false;
  if (cacheEntry.source_fingerprint !== sourceFingerprint) return false;
  if (!existsSync(getGridPath(repoRoot, listingId))) return false;
  if (strictFingerprintCache || sourceFingerprint.startsWith("sha256:")) {
    return true;
  }
  const lastChecked = Date.parse(cacheEntry.last_checked_at);
  if (!Number.isFinite(lastChecked)) return false;
  return now.getTime() - lastChecked <= UNCHANGED_SKIP_WINDOW_MS;
}

export function writeGridFile(
  repoRoot: string,
  listingId: string,
  grid: FeatureCollection<Polygon, GeoJsonProperties>,
): void {
  writeFileSync(getGridPath(repoRoot, listingId), `${JSON.stringify(grid)}\n`, "utf-8");
}

export function buildGridCacheEntry(): { schema_version: number } {
  return { schema_version: GRID_SCHEMA_VERSION };
}
