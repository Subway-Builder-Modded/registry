import type { PlayableAreaMetrics } from "./map-playable-area.js";

// The generated detail metrics that are written into grid.geojson properties
// and mirrored into manifest grid_statistics for app/analytics consumption.
export interface GridDetailProperties {
  // Geometric mean of resident and worker weighted nearest-neighbor medians.
  radiusKm: number;
  // Expected spacing proxy derived from occupied grid cells relative to points.
  expectedPointSpacingKm: number;
  // Radius normalized against occupied-footprint spacing so broad maps are not
  // punished purely for spanning more territory.
  normalizedRadius: number;
  // Geometric mean demand carried per point across residents and jobs.
  activityPerPoint: number;
  // Estimated playable area after the demand-only raster refinement pass.
  playableAreaKm2: number;
  // Estimated playable area allocated to each demand point.
  playableAreaPerPointKm2: number;
  // Circular-equivalent radius of the playable area assigned to each point.
  playableCatchmentRadiusKm: number;
  // How locally fine-grained the map is after adjusting for occupied footprint.
  localityScore: number;
  // How deaggregated the demand representation is across playable area.
  deaggregationScore: number;
  // Final hybrid detail score, using the geometric mean of locality and
  // deaggregation so both dimensions must be strong.
  score: number;
}

// Raw inputs needed to compute the hybrid detail metrics from the generated
// demand/grid analysis, before any repo-level CSV formatting or rounding.
export interface GridDetailMetricInputs {
  // Median resident-weighted nearest-neighbor spacing in kilometers.
  residentMedianWeightedNearestNeighborKm: number;
  // Median worker-weighted nearest-neighbor spacing in kilometers.
  workerMedianWeightedNearestNeighborKm: number;
  // Number of populated grid cells after empty cells are filtered out.
  populatedCellCount: number;
  // Number of demand points in the map.
  pointCount: number;
  // Total residents represented by the demand payload.
  residentsTotal: number;
  // Total jobs represented by the demand payload.
  jobsTotal: number;
  // Estimated playable area metrics derived from demand geometry.
  playableArea: PlayableAreaMetrics;
}

// Fixed anchors keep the score stable across analytics runs instead of
// re-normalizing against whatever subset of maps happens to be present.
//
// Locality uses a low/high reference rather than exact dynamic percentiles:
// - `HIGH_DETAIL` is the higher-detail (10th percentile) side of the normalized-radius distribution.
//   Maps at or below this are already locally fine-grained, so they should
//   score near the top on locality.
// - `LOW_DETAIL` is the coarse tail of the normalized-radius distribution. Using the
//   far upper end (99th percentile) to avoids over-penalizing broad
//   but still reasonable maps.
//
// Playable catchment uses the same pattern:
// - `LOW_REF` is the tighter, more deaggregated end of the per-point playable
//   catchment distribution. Maps around here are assigning each point to a
//   relatively small, realistic area.
// - `HIGH_REF` is the loose/aggregated end. Maps around or above this are
//   asking each point to stand in for too much playable territory, so the
//   deaggregation score should trend toward zero.
//
// We use a low/high anchor pair instead of recomputing per-run percentiles so
// the score remains interpretable and comparable over time.
export const DETAIL_LOCALITY_HIGH_DETAIL_REF = 0.35;
export const DETAIL_LOCALITY_LOW_DETAIL_REF = 0.9;
// TODO: Adjust these as needed once we have more map data to analyze the playable catchment distribution.
export const DETAIL_PLAYABLE_CATCHMENT_LOW_REF = 0.6;
export const DETAIL_PLAYABLE_CATCHMENT_HIGH_REF = 1.0;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeInverseLogScaledScore(value: number, lowRef: number, highRef: number): number {
  if (value <= 0 || lowRef <= 0 || highRef <= 0 || highRef <= lowRef) return 0;
  const numerator = Math.log(highRef) - Math.log(value);
  const denominator = Math.log(highRef) - Math.log(lowRef);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return clamp01(numerator / denominator);
}

export function computeDetailRadiusKm(
  residentMedianWeightedNearestNeighborKm: number,
  workerMedianWeightedNearestNeighborKm: number,
): number {
  if (residentMedianWeightedNearestNeighborKm <= 0 || workerMedianWeightedNearestNeighborKm <= 0) {
    return 0;
  }
  return Math.sqrt(residentMedianWeightedNearestNeighborKm * workerMedianWeightedNearestNeighborKm);
}

export function computeGridDetailMetrics(inputs: GridDetailMetricInputs): GridDetailProperties {
  const radiusKm = computeDetailRadiusKm(
    inputs.residentMedianWeightedNearestNeighborKm,
    inputs.workerMedianWeightedNearestNeighborKm,
  );
  // Expected point spacing is still the locality-side footprint proxy.
  const expectedPointSpacingKm = (
    inputs.populatedCellCount > 0 && inputs.pointCount > 0
      ? Math.sqrt(inputs.populatedCellCount / inputs.pointCount)
      : 0
  );
  // Normalizing the radius by expected point spacing means that broad maps are
  // not punished purely for having larger absolute nearest-neighbor distances.
  const normalizedRadius = radiusKm > 0 && expectedPointSpacingKm > 0
    ? radiusKm / expectedPointSpacingKm
    : 0;
  // This stays in the output as a diagnostic, but is no longer part of the score.
  const activityPerPoint = (
    inputs.pointCount > 0 && inputs.residentsTotal > 0 && inputs.jobsTotal > 0
      ? Math.sqrt(
        (inputs.residentsTotal / inputs.pointCount)
        * (inputs.jobsTotal / inputs.pointCount),
      )
      : 0
  );
  const localityScore = computeInverseLogScaledScore(
    normalizedRadius,
    DETAIL_LOCALITY_HIGH_DETAIL_REF,
    DETAIL_LOCALITY_LOW_DETAIL_REF,
  );
  const deaggregationScore = computeInverseLogScaledScore(
    inputs.playableArea.playableCatchmentRadiusKm,
    DETAIL_PLAYABLE_CATCHMENT_LOW_REF,
    DETAIL_PLAYABLE_CATCHMENT_HIGH_REF,
  );
  const score = localityScore > 0 && deaggregationScore > 0
    ? Math.sqrt(localityScore * deaggregationScore)
    : 0;

  return {
    radiusKm,
    expectedPointSpacingKm,
    normalizedRadius,
    activityPerPoint,
    playableAreaKm2: inputs.playableArea.playableAreaKm2,
    playableAreaPerPointKm2: inputs.playableArea.playableAreaPerPointKm2,
    playableCatchmentRadiusKm: inputs.playableArea.playableCatchmentRadiusKm,
    localityScore,
    deaggregationScore,
    score,
  };
}
