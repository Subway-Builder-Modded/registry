import { existsSync } from "node:fs";
import { join } from "node:path";
import { isObject, readJsonFile } from "../json-utils.js";
import { resolveAuthorPresentation, type AuthorAliasIndex } from "../author-aliases.js";
import type { MapStatisticsRow } from "./types.js";

export function toNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export interface GridCellFeatureProperties {
  jobs?: unknown;
  pop?: unknown;
  pointCount?: unknown;
}

export interface GridMetricBundleProperties {
  p10?: unknown;
  p25?: unknown;
  p50?: unknown;
  p75?: unknown;
  p90?: unknown;
  mean?: unknown;
}

export interface GridPolycentrismActivityProperties {
  continuousScore?: unknown;
  detectedCenterCount?: unknown;
}

export interface GridPolycentrismProperties {
  activity?: unknown;
}

export interface GridDetailProperties {
  radiusKm?: unknown;
  playableAreaKm2?: unknown;
  playableAreaPerPointKm2?: unknown;
  playableCatchmentRadiusKm?: unknown;
  score?: unknown;
}

export interface GridSummary {
  n_cells: number;
  mean_point_density: number;
  median_resident_weighted_nn_km: number;
  mean_resident_weighted_nn_km: number;
  median_worker_weighted_nn_km: number;
  mean_worker_weighted_nn_km: number;
  detail_radius_km: number;
  detail_score: number;
  playable_area_cells: number;
  median_cell_resident_density: number;
  mean_cell_resident_density: number;
  pct_cells_with_residents: number;
  median_cell_worker_density: number;
  mean_cell_worker_density: number;
  pct_cells_with_workers: number;
  median_commute_distance: number;
  mean_commute_distance: number;
  detected_center_count: number;
  polycentrism_score: number;
}

export function emptyGridSummary(): GridSummary {
  return {
    n_cells: 0,
    mean_point_density: 0,
    median_resident_weighted_nn_km: 0,
    mean_resident_weighted_nn_km: 0,
    median_worker_weighted_nn_km: 0,
    mean_worker_weighted_nn_km: 0,
    detail_radius_km: 0,
    detail_score: 0,
    playable_area_cells: 0,
    median_cell_resident_density: 0,
    mean_cell_resident_density: 0,
    pct_cells_with_residents: 0,
    median_cell_worker_density: 0,
    mean_cell_worker_density: 0,
    pct_cells_with_workers: 0,
    median_commute_distance: 0,
    mean_commute_distance: 0,
    detected_center_count: 0,
    polycentrism_score: 0,
  };
}

export function roundTo(value: number, decimalPlaces = 2): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

export function nonZeroMedian(values: number[]): number {
  return medianOf(values.filter((value) => value > 0));
}

export function nonZeroMean(values: number[]): number {
  const filtered = values.filter((value) => value > 0);
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function percentNonZero(values: number[], totalCount: number): number {
  if (totalCount <= 0) return 0;
  return (values.filter((value) => value > 0).length / totalCount) * 100;
}

export function readGridMetricBundle(
  properties: Record<string, unknown>,
  key: string,
): { p50: number; mean: number } {
  const bundle = isObject(properties[key]) ? properties[key] as GridMetricBundleProperties : null;
  if (!bundle) {
    return { p50: 0, mean: 0 };
  }
  return {
    p50: toNonNegativeNumber(bundle.p50),
    mean: toNonNegativeNumber(bundle.mean),
  };
}

export function readGridDetailSummary(
  properties: Record<string, unknown>,
): {
  present: boolean;
  radiusKm: number;
  playableAreaKm2: number;
  playableAreaPerPointKm2: number;
  playableCatchmentRadiusKm: number;
  score: number;
} {
  const detail = isObject(properties.detail)
    ? properties.detail as GridDetailProperties
    : null;

  if (!detail) {
    return {
      present: false,
      radiusKm: 0,
      playableAreaKm2: 0,
      playableAreaPerPointKm2: 0,
      playableCatchmentRadiusKm: 0,
      score: 0,
    };
  }

  const playableAreaKm2 = toNonNegativeNumber(detail.playableAreaKm2);
  const playableAreaPerPointKm2 = toNonNegativeNumber(detail.playableAreaPerPointKm2);
  const playableCatchmentRadiusKm = toNonNegativeNumber(detail.playableCatchmentRadiusKm);
  const hasPlayableAreaShape = (
    playableAreaKm2 > 0
    || playableAreaPerPointKm2 > 0
    || playableCatchmentRadiusKm > 0
  );

  return {
    present: hasPlayableAreaShape,
    radiusKm: toNonNegativeNumber(detail.radiusKm),
    playableAreaKm2,
    playableAreaPerPointKm2,
    playableCatchmentRadiusKm,
    score: toNonNegativeNumber(detail.score),
  };
}

export function readGridPolycentrismSummary(
  properties: Record<string, unknown>,
): { detectedCenterCount: number; continuousScore: number } {
  const polycentrism = isObject(properties.polycentrism)
    ? properties.polycentrism as GridPolycentrismProperties
    : null;
  const activity = polycentrism && isObject(polycentrism.activity)
    ? polycentrism.activity as GridPolycentrismActivityProperties
    : null;

  return {
    detectedCenterCount: toNonNegativeNumber(activity?.detectedCenterCount),
    continuousScore: toNonNegativeNumber(activity?.continuousScore),
  };
}

export function loadGridSummary(repoRoot: string, id: string): GridSummary {
  const gridPath = join(repoRoot, "maps", id, "grid.geojson");
  if (!existsSync(gridPath)) return emptyGridSummary();

  try {
    const grid = readJsonFile<Record<string, unknown>>(gridPath);
    const features = Array.isArray(grid.features) ? grid.features : [];
    const gridProperties = isObject(grid.properties) ? grid.properties : {};
    const commuteSummary = readGridMetricBundle(gridProperties, "commuteDistanceKm");
    const residentWeightedNearestNeighborSummary = readGridMetricBundle(gridProperties, "residentWeightedNearestNeighborKm");
    const workerWeightedNearestNeighborSummary = readGridMetricBundle(gridProperties, "workerWeightedNearestNeighborKm");
    const detailSummary = readGridDetailSummary(gridProperties);
    const polycentrismSummary = readGridPolycentrismSummary(gridProperties);
    const populatedCells = features
      .map((feature) => {
        if (!isObject(feature)) return null;
        const properties = isObject(feature.properties)
          ? feature.properties as GridCellFeatureProperties
          : {};
        const pointCount = toNonNegativeNumber(properties.pointCount);
        if (pointCount <= 0) return null;
        return {
          pointCount,
          pop: toNonNegativeNumber(properties.pop),
          jobs: toNonNegativeNumber(properties.jobs),
        };
      })
      .filter((feature): feature is { pointCount: number; pop: number; jobs: number } => feature !== null);

    const nCells = populatedCells.length;
    const pointCounts = populatedCells.map((cell) => cell.pointCount);
    const residentCounts = populatedCells.map((cell) => cell.pop);
    const workerCounts = populatedCells.map((cell) => cell.jobs);
    const totalPoints = pointCounts.reduce((sum, value) => sum + value, 0);
    const detailRadiusKm = detailSummary.present ? detailSummary.radiusKm : 0;
    const detailScore = detailSummary.present ? detailSummary.score : 0;
    const playableAreaCellCount = detailSummary.present ? detailSummary.playableAreaKm2 : 0;
    if (nCells === 0) {
      return {
        ...emptyGridSummary(),
        median_resident_weighted_nn_km: roundTo(residentWeightedNearestNeighborSummary.p50, 3),
        mean_resident_weighted_nn_km: roundTo(residentWeightedNearestNeighborSummary.mean, 3),
        median_worker_weighted_nn_km: roundTo(workerWeightedNearestNeighborSummary.p50, 3),
        mean_worker_weighted_nn_km: roundTo(workerWeightedNearestNeighborSummary.mean, 3),
        detail_radius_km: roundTo(detailRadiusKm, 3),
        detail_score: roundTo(detailScore),
        playable_area_cells: Math.round(playableAreaCellCount),
        median_commute_distance: commuteSummary.p50,
        mean_commute_distance: commuteSummary.mean,
        detected_center_count: polycentrismSummary.detectedCenterCount,
        polycentrism_score: roundTo(polycentrismSummary.continuousScore),
      };
    }

    return {
      n_cells: nCells,
      mean_point_density: roundTo(totalPoints / nCells),
      median_resident_weighted_nn_km: roundTo(residentWeightedNearestNeighborSummary.p50, 3),
      mean_resident_weighted_nn_km: roundTo(residentWeightedNearestNeighborSummary.mean, 3),
      median_worker_weighted_nn_km: roundTo(workerWeightedNearestNeighborSummary.p50, 3),
      mean_worker_weighted_nn_km: roundTo(workerWeightedNearestNeighborSummary.mean, 3),
      detail_radius_km: roundTo(detailRadiusKm, 3),
      detail_score: roundTo(detailScore),
      playable_area_cells: Math.round(playableAreaCellCount),
      median_cell_resident_density: roundTo(nonZeroMedian(residentCounts)),
      mean_cell_resident_density: roundTo(nonZeroMean(residentCounts)),
      pct_cells_with_residents: roundTo(percentNonZero(residentCounts, nCells)),
      median_cell_worker_density: roundTo(nonZeroMedian(workerCounts)),
      mean_cell_worker_density: roundTo(nonZeroMean(workerCounts)),
      pct_cells_with_workers: roundTo(percentNonZero(workerCounts, nCells)),
      median_commute_distance: roundTo(commuteSummary.p50),
      mean_commute_distance: roundTo(commuteSummary.mean),
      detected_center_count: polycentrismSummary.detectedCenterCount,
      polycentrism_score: roundTo(polycentrismSummary.continuousScore),
    };
  } catch {
    return emptyGridSummary();
  }
}

export function loadMapStatisticsRows(repoRoot: string, authorAliases: AuthorAliasIndex): MapStatisticsRow[] {
  const indexPath = join(repoRoot, "maps", "index.json");
  const index = readJsonFile<{ maps?: unknown }>(indexPath);
  const mapIds = Array.isArray(index.maps)
    ? index.maps.filter((value): value is string => typeof value === "string")
    : [];

  const rows: Omit<MapStatisticsRow, "rank">[] = [];
  for (const id of mapIds) {
    const manifestPath = join(repoRoot, "maps", id, "manifest.json");
    try {
      const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
      const author = toNonEmptyString(manifest.author, "UNKNOWN");
      const githubId = typeof manifest.github_id === "number" && Number.isFinite(manifest.github_id)
        ? manifest.github_id
        : null;
      const presentation = resolveAuthorPresentation(author, githubId, authorAliases);
      const gridSummary = loadGridSummary(repoRoot, id);
      rows.push({
        id,
        name: toNonEmptyString(manifest.name, id),
        author: presentation.author,
        author_alias: presentation.author_alias,
        attribution_link: presentation.attribution_link,
        city_code: toNonEmptyString(manifest.city_code, ""),
        country: toNonEmptyString(manifest.country, ""),
        population: toNonNegativeNumber(manifest.population),
        population_count: toNonNegativeNumber(manifest.population_count),
        points_count: toNonNegativeNumber(manifest.points_count),
        ...gridSummary,
      });
    } catch {
      rows.push({
        id,
        name: id,
        author: "UNKNOWN",
        author_alias: "UNKNOWN",
        attribution_link: "https://github.com/UNKNOWN",
        city_code: "",
        country: "",
        population: 0,
        population_count: 0,
        points_count: 0,
        ...emptyGridSummary(),
      });
    }
  }

  rows.sort((a, b) =>
    b.population - a.population
    || b.n_cells - a.n_cells
    || b.population_count - a.population_count
    || b.points_count - a.points_count
    || a.id.localeCompare(b.id));

  return rows.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));
}
