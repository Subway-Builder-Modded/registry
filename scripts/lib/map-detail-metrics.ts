export interface GridDetailProperties {
  radiusKm: number;
  expectedPointSpacingKm: number;
  normalizedRadius: number;
  activityPerPoint: number;
  localityScore: number;
  deaggregationScore: number;
  score: number;
}

export interface GridDetailMetricInputs {
  residentMedianWeightedNearestNeighborKm: number;
  workerMedianWeightedNearestNeighborKm: number;
  populatedCellCount: number;
  pointCount: number;
  residentsTotal: number;
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
