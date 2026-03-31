import { resolve } from "node:path";
import type { MapManifest } from "../manifests.js";
import { readJsonFile } from "./shared.js";

export function getMapIds(repoRoot: string): string[] {
  const indexPath = resolve(repoRoot, "maps", "index.json");
  const parsed = readJsonFile<{ maps?: unknown }>(indexPath);
  if (!Array.isArray(parsed.maps)) {
    throw new Error(`Invalid index file at ${indexPath}: missing 'maps' array`);
  }
  return parsed.maps.filter((value): value is string => typeof value === "string");
}

export function getMapManifest(repoRoot: string, id: string): MapManifest {
  return readJsonFile<MapManifest>(resolve(repoRoot, "maps", id, "manifest.json"));
}

export function applyDerivedFieldDefaults(manifest: MapManifest): boolean {
  const fallbackResidents = Number.isFinite(manifest.population)
    ? manifest.population
    : 0;
  const nextResidentsTotal = Number.isFinite(manifest.residents_total)
    ? manifest.residents_total
    : fallbackResidents;
  const nextPointsCount = Number.isFinite(manifest.points_count)
    ? manifest.points_count
    : 0;
  const nextPopulationCount = Number.isFinite(manifest.population_count)
    ? manifest.population_count
    : 0;
  const rawFileSizes = manifest.file_sizes;
  const nextFileSizes: Record<string, number> = {};
  if (rawFileSizes && typeof rawFileSizes === "object" && !Array.isArray(rawFileSizes)) {
    for (const [key, value] of Object.entries(rawFileSizes)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        nextFileSizes[key] = value;
      }
    }
  }

  const changed = (
    manifest.residents_total !== nextResidentsTotal
    || manifest.points_count !== nextPointsCount
    || manifest.population_count !== nextPopulationCount
    || JSON.stringify(manifest.file_sizes ?? {}) !== JSON.stringify(nextFileSizes)
  );

  manifest.residents_total = nextResidentsTotal;
  manifest.points_count = nextPointsCount;
  manifest.population_count = nextPopulationCount;
  manifest.file_sizes = nextFileSizes;
  return changed;
}
