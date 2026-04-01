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
  // How locally fine-grained the map is after adjusting for occupied footprint.
  localityScore: number;
  // How deaggregated the demand representation is per point.
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
}

// Fixed anchors keep the score stable across analytics runs instead of
// re-normalizing against whatever subset of maps happens to be present.
export const DETAIL_LOCALITY_R10_REF = 0.3432329744;
export const DETAIL_LOCALITY_R99_REF = 0.8885200016;
export const DETAIL_DEAGGREGATION_A50_REF = 232.1246833;
export const DETAIL_DEAGGREGATION_A99_REF = 3426.9280920;

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
  const expectedPointSpacingKm = (
    inputs.populatedCellCount > 0 && inputs.pointCount > 0
      ? Math.sqrt(inputs.populatedCellCount / inputs.pointCount)
      : 0
  );
  const normalizedRadius = radiusKm > 0 && expectedPointSpacingKm > 0
    ? radiusKm / expectedPointSpacingKm
    : 0;
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
    DETAIL_LOCALITY_R10_REF,
    DETAIL_LOCALITY_R99_REF,
  );
  const deaggregationScore = computeInverseLogScaledScore(
    activityPerPoint,
    DETAIL_DEAGGREGATION_A50_REF,
    DETAIL_DEAGGREGATION_A99_REF,
  );
  const score = localityScore > 0 && deaggregationScore > 0
    ? Math.sqrt(localityScore * deaggregationScore)
    : 0;

  return {
    radiusKm,
    expectedPointSpacingKm,
    normalizedRadius,
    activityPerPoint,
    localityScore,
    deaggregationScore,
    score,
  };
}
