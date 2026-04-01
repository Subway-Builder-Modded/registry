import type { DemandData, MetricSummary } from "./map-analytics-grid.js";

export interface PolycentrismCenter {
  longitude: number;
  latitude: number;
  massShare: number;
  assignedMass: number;
  assignedPointCount: number;
}

export interface PolycentrismVariantMetrics {
  score: number;
  detectedCenterCount: number;
  effectiveCenterCount: number;
  largestCenterShare: number;
  bandwidthKm: number;
  reliabilityScore: number;
  supportLevel: "low" | "medium" | "high";
  usedFallback: boolean;
  topCenters: PolycentrismCenter[];
}

export interface PolycentrismMetrics {
  residents: PolycentrismVariantMetrics;
  activity: PolycentrismVariantMetrics;
}

interface ProjectedPoint {
  index: number;
  longitude: number;
  latitude: number;
  xKm: number;
  yKm: number;
  mass: number;
}

interface PeakSeed {
  xKm: number;
  yKm: number;
  longitude: number;
  latitude: number;
  potential: number;
}

interface CenterAssignment {
  seed: PeakSeed;
  assignedMass: number;
  assignedPointCount: number;
  longitudeMass: number;
  latitudeMass: number;
}

export interface PolycentrismDetailMetrics {
  residentWeightedNearestNeighborKm?: Partial<MetricSummary>;
  workerWeightedNearestNeighborKm?: Partial<MetricSummary>;
}

const GAUSSIAN_DISTANCE_MULTIPLIER = 3;
const MAX_TOP_CENTERS = 5;
const EARTH_RADIUS_KM = 6371.0088;
const DEGREES_TO_RADIANS = Math.PI / 180;
const KILOMETERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;
// Minimum assigned mass share for non-primary centres. This keeps tiny stray
// clusters from being promoted into full centres.
const MIN_CENTER_SHARE = 0.07;
// Require at least two assigned points for a stable secondary centre.
const MIN_POINTS_PER_CENTER = 2;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(value, maxValue));
}

function emptyVariantMetrics(): PolycentrismVariantMetrics {
  return {
    score: 0,
    detectedCenterCount: 0,
    effectiveCenterCount: 0,
    largestCenterShare: 0,
    bandwidthKm: 0,
    reliabilityScore: 0,
    supportLevel: "low",
    usedFallback: false,
    topCenters: [],
  };
}

function readMetricP50(metric: Partial<MetricSummary> | undefined): number {
  return typeof metric?.p50 === "number" && Number.isFinite(metric.p50) && metric.p50 > 0
    ? metric.p50
    : 0;
}

function buildProjectedPoints(
  demandData: DemandData,
  massForPoint: (point: DemandData["points"][number]) => number,
): ProjectedPoint[] {
  // Weight each point by its resident count or total activity (residents + jobs) so the algorithm does not only consider spatial density but also demand intensity
  const weightedPoints = demandData.points
    .map((point, index) => ({
      index,
      longitude: point.location[0],
      latitude: point.location[1],
      mass: massForPoint(point),
    }))
    .filter((point) => Number.isFinite(point.mass) && point.mass > 0);

  if (weightedPoints.length === 0) {
    return [];
  }

  // Convert lon/lat into an approximate local kilometer grid so distance-based clustering can work in linear units without doing repeated geodesic math.
  const meanLatitudeRadians = (
    weightedPoints.reduce((sum, point) => sum + point.latitude, 0) / weightedPoints.length
  ) * DEGREES_TO_RADIANS;
  const lonScale = KILOMETERS_PER_DEGREE * Math.cos(meanLatitudeRadians);
  const latScale = KILOMETERS_PER_DEGREE;

  return weightedPoints.map((point) => ({
    ...point,
    xKm: point.longitude * lonScale,
    yKm: point.latitude * latScale,
  }));
}

function squaredDistanceKm(a: { xKm: number; yKm: number }, b: { xKm: number; yKm: number }): number {
  const dx = a.xKm - b.xKm;
  const dy = a.yKm - b.yKm;
  return (dx * dx) + (dy * dy);
}

function distanceKm(a: { xKm: number; yKm: number }, b: { xKm: number; yKm: number }): number {
  return Math.sqrt(squaredDistanceKm(a, b));
}

function gaussianWeight(distanceKmValue: number, bandwidthKm: number): number {
  if (bandwidthKm <= 0) return 0;
  const scaled = distanceKmValue / bandwidthKm;
  return Math.exp(-0.5 * scaled * scaled);
}

// Build a spatial index to efficiently query nearby points within a radius.
// The index buckets points into grid cells, and nearby points will be in the same or adjacent cells.
function buildSpatialIndex(points: Array<{ xKm: number; yKm: number }>, cellSizeKm: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  const safeCellSizeKm = Math.max(cellSizeKm, 0.25);
  points.forEach((point, pointIndex) => {
    const key = `${Math.floor(point.xKm / safeCellSizeKm)}:${Math.floor(point.yKm / safeCellSizeKm)}`;
    const bucket = index.get(key) ?? [];
    bucket.push(pointIndex);
    index.set(key, bucket);
  });
  return index;
}

// Query the spatial index to get candidate neighbor indexes within a radius.
function getNeighborIndexes(
  point: { xKm: number; yKm: number },
  cellSizeKm: number,
  radiusKm: number,
  index: Map<string, number[]>,
): number[] {
  const safeCellSizeKm = Math.max(cellSizeKm, 0.25);
  const cellX = Math.floor(point.xKm / safeCellSizeKm);
  const cellY = Math.floor(point.yKm / safeCellSizeKm);
  const cellRadius = Math.max(1, Math.ceil(radiusKm / safeCellSizeKm));
  const neighborIndexes: number[] = [];
  for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
    for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
      const bucket = index.get(`${cellX + dx}:${cellY + dy}`);
      if (!bucket) continue;
      neighborIndexes.push(...bucket);
    }
  }
  return neighborIndexes;
}

// Compute a smoothed potential field by summing Gaussian-weighted mass from nearby points.
function computePotentials(points: ProjectedPoint[], bandwidthKm: number): number[] {
  if (points.length === 0) return [];
  const cellSizeKm = Math.max(bandwidthKm, 0.5);
  const radiusKm = bandwidthKm * GAUSSIAN_DISTANCE_MULTIPLIER;
  const radiusSquaredKm = radiusKm * radiusKm;
  const index = buildSpatialIndex(points, cellSizeKm);

  // Estimate each point's local gravity field by summing nearby mass with a Gaussian distance decay. This results in a smoothed potential surface to identify local peaks
  return points.map((point) => {
    const neighborIndexes = getNeighborIndexes(point, cellSizeKm, radiusKm, index);
    let potential = 0;
    for (const neighborIndex of neighborIndexes) {
      const neighbor = points[neighborIndex]!;
      const squaredDistance = squaredDistanceKm(point, neighbor);
      if (squaredDistance > radiusSquaredKm) continue;
      potential += neighbor.mass * gaussianWeight(Math.sqrt(squaredDistance), bandwidthKm);
    }
    return potential;
  });
}

// Identify local peaks in the potential surface by comparing each point to its neighbors. 
// A point is a peak if no nearby point has a significantly higher potential, or a similar potential but higher mass. 
function detectPointPeaks(points: ProjectedPoint[], potentials: number[], bandwidthKm: number): PeakSeed[] {
  if (points.length === 0) return [];
  const cellSizeKm = Math.max(bandwidthKm, 0.5);
  const comparisonRadiusKm = Math.max(bandwidthKm * 1.5, 1);
  const comparisonRadiusSquaredKm = comparisonRadiusKm * comparisonRadiusKm;
  const index = buildSpatialIndex(points, cellSizeKm);

  const peaks: PeakSeed[] = [];
  points.forEach((point, pointIndex) => {
    const neighborIndexes = getNeighborIndexes(point, cellSizeKm, comparisonRadiusKm, index);
    const pointPotential = potentials[pointIndex] ?? 0;
    let isPeak = true;
    for (const neighborIndex of neighborIndexes) {
      if (neighborIndex === pointIndex) continue;
      const neighbor = points[neighborIndex]!;
      if (squaredDistanceKm(point, neighbor) > comparisonRadiusSquaredKm) continue;
      const neighborPotential = potentials[neighborIndex] ?? 0;
      if (neighborPotential > pointPotential * 1.01) {
        isPeak = false;
        break;
      }
      if (
        neighborPotential >= pointPotential * 0.999
        && neighbor.mass > point.mass
      ) {
        isPeak = false;
        break;
      }
    }
    if (!isPeak) return;
    // A peak seed is a local maximum in the smoothed potential surface.
    peaks.push({
      xKm: point.xKm,
      yKm: point.yKm,
      longitude: point.longitude,
      latitude: point.latitude,
      potential: pointPotential,
    });
  });

  return peaks;
}

function detectFallbackGridPeaks(points: ProjectedPoint[], bandwidthKm: number): PeakSeed[] {
  if (points.length === 0) return [];
  // For sparse/unstable point clouds, coarsen the space into broader cells and
  // detect peaks on that aggregated surface instead of raw point potentials.
  const cellSizeKm = Math.max(bandwidthKm, 1);
  const cells = new Map<string, {
    mass: number;
    xKmMass: number;
    yKmMass: number;
    longitudeMass: number;
    latitudeMass: number;
  }>();

  for (const point of points) {
    const cellX = Math.floor(point.xKm / cellSizeKm);
    const cellY = Math.floor(point.yKm / cellSizeKm);
    const key = `${cellX}:${cellY}`;
    const cell = cells.get(key) ?? {
      mass: 0,
      xKmMass: 0,
      yKmMass: 0,
      longitudeMass: 0,
      latitudeMass: 0,
    };
    cell.mass += point.mass;
    cell.xKmMass += point.xKm * point.mass;
    cell.yKmMass += point.yKm * point.mass;
    cell.longitudeMass += point.longitude * point.mass;
    cell.latitudeMass += point.latitude * point.mass;
    cells.set(key, cell);
  }

  const coarsePoints = [...cells.values()]
    .filter((cell) => cell.mass > 0)
    .map((cell, index) => {
      const longitude = cell.longitudeMass / cell.mass;
      const latitude = cell.latitudeMass / cell.mass;
      return {
        index,
        longitude,
        latitude,
        xKm: cell.xKmMass / cell.mass,
        yKm: cell.yKmMass / cell.mass,
        mass: cell.mass,
      };
    });

  if (coarsePoints.length === 0) return [];

  const potentials = computePotentials(coarsePoints, Math.max(bandwidthKm * 1.15, 1));
  return detectPointPeaks(coarsePoints, potentials, Math.max(bandwidthKm * 1.15, 1));
}

function mergePeaks(peaks: PeakSeed[], bandwidthKm: number): PeakSeed[] {
  if (peaks.length <= 1) return peaks;
  const mergeDistanceKm = Math.max(bandwidthKm * 1.5, 1.5);
  const sortedPeaks = [...peaks].sort((a, b) => b.potential - a.potential);
  const merged: PeakSeed[] = [];

  // Nearby local maxima usually belong to the same centre; keep the strongest
  // one so downstream centre counts are not inflated by tiny local wiggles.
  for (const peak of sortedPeaks) {
    const overlaps = merged.some((existingPeak) => distanceKm(peak, existingPeak) <= mergeDistanceKm);
    if (!overlaps) {
      merged.push(peak);
    }
  }

  return merged;
}

function assignPointsToPeaks(
  points: ProjectedPoint[],
  peaks: PeakSeed[],
  bandwidthKm: number,
): CenterAssignment[] {
  if (points.length === 0 || peaks.length === 0) return [];
  const centers = peaks.map((peak) => ({
    seed: peak,
    assignedMass: 0,
    assignedPointCount: 0,
    longitudeMass: 0,
    latitudeMass: 0,
  }));
  const assignmentBandwidthKm = Math.max(bandwidthKm * 1.2, 1);

  // Assign each point to the peak whose decayed potential dominates at that
  // location. Centre shares are then computed from these raw point assignments.
  for (const point of points) {
    let bestCenter = centers[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const center of centers) {
      const centerDistanceKm = distanceKm(point, center.seed);
      const centerScore = center.seed.potential * gaussianWeight(centerDistanceKm, assignmentBandwidthKm);
      if (centerScore > bestScore) {
        bestScore = centerScore;
        bestCenter = center;
      }
    }
    bestCenter.assignedMass += point.mass;
    bestCenter.assignedPointCount += 1;
    bestCenter.longitudeMass += point.longitude * point.mass;
    bestCenter.latitudeMass += point.latitude * point.mass;
  }

  return centers;
}

function computeEffectivePointCount(points: ProjectedPoint[]): number {
  if (points.length === 0) return 0;
  const totalMass = points.reduce((sum, point) => sum + point.mass, 0);
  const squaredMassSum = points.reduce((sum, point) => sum + (point.mass * point.mass), 0);
  if (totalMass <= 0 || squaredMassSum <= 0) return 0;
  return (totalMass * totalMass) / squaredMassSum;
}

function classifySupportLevel(reliabilityScore: number): "low" | "medium" | "high" {
  if (reliabilityScore >= 0.7) return "high";
  if (reliabilityScore >= 0.4) return "medium";
  return "low";
}

function computeBoundingExtentKm(points: ProjectedPoint[]): number {
  if (points.length <= 1) return 1;
  const minX = Math.min(...points.map((point) => point.xKm));
  const maxX = Math.max(...points.map((point) => point.xKm));
  const minY = Math.min(...points.map((point) => point.yKm));
  const maxY = Math.max(...points.map((point) => point.yKm));
  return Math.max(maxX - minX, maxY - minY, 1);
}

function estimateBaseSpacingKm(
  variant: "residents" | "activity",
  demandData: DemandData,
  detailMetrics: PolycentrismDetailMetrics | undefined,
): number {
  // Reuse the previously computed nearest-neighbor spacing as an anchor so
  // sparse maps smooth more aggressively and dense maps preserve finer centres.
  const residentP50 = readMetricP50(detailMetrics?.residentWeightedNearestNeighborKm);
  const workerP50 = readMetricP50(detailMetrics?.workerWeightedNearestNeighborKm);
  if (variant === "residents") {
    return residentP50 > 0 ? residentP50 : Math.max(workerP50, 1);
  }

  const totalResidents = demandData.points.reduce((sum, point) => sum + Math.max(point.residents, 0), 0);
  const totalJobs = demandData.points.reduce((sum, point) => sum + Math.max(point.jobs, 0), 0);
  const totalMass = totalResidents + totalJobs;
  if (totalMass <= 0) {
    return Math.max(residentP50, workerP50, 1);
  }
  const weightedSpacing = (
    (residentP50 * totalResidents)
    + ((workerP50 > 0 ? workerP50 : residentP50) * totalJobs)
  ) / totalMass;
  return weightedSpacing > 0 ? weightedSpacing : Math.max(residentP50, workerP50, 1);
}

function computeBandwidthKm(
  points: ProjectedPoint[],
  baseSpacingKm: number,
): number {
  const effectivePointCount = computeEffectivePointCount(points);
  const pointCount = points.length;
  let sparsityMultiplier = 1.3;
  if (pointCount < 15 || effectivePointCount < 6) {
    sparsityMultiplier = 2.5;
  } else if (pointCount < 50 || effectivePointCount < 15) {
    sparsityMultiplier = 2;
  } else if (pointCount < 200 || effectivePointCount < 50) {
    sparsityMultiplier = 1.6;
  }

  const extentKm = computeBoundingExtentKm(points);
  const unclampedBandwidth = Math.max(baseSpacingKm, 1) * sparsityMultiplier;
  // Keep the kernel large enough to regularize sparse layouts, but cap it so
  // very wide maps do not collapse into a single over-smoothed centre.
  return clamp(unclampedBandwidth, 1, Math.max(3, extentKm * 0.35));
}

function buildVariantMetrics(
  demandData: DemandData,
  detailMetrics: PolycentrismDetailMetrics | undefined,
  variant: "residents" | "activity",
): PolycentrismVariantMetrics {
  // Build one variant at a time so resident-only and combined activity
  // polycentrism can be compared directly from the same spatial layout.
  const points = buildProjectedPoints(demandData, (point) => (
    variant === "residents"
      ? point.residents
      : point.residents + point.jobs
  ));
  if (points.length === 0) return emptyVariantMetrics();

  const totalMass = points.reduce((sum, point) => sum + point.mass, 0);
  if (totalMass <= 0) return emptyVariantMetrics();

  const baseSpacingKm = estimateBaseSpacingKm(variant, demandData, detailMetrics);
  const bandwidthKm = computeBandwidthKm(points, baseSpacingKm);
  const potentials = computePotentials(points, bandwidthKm);
  const rawPeaks = detectPointPeaks(points, potentials, bandwidthKm);

  // For very sparse or noisy point clouds, the above peak detection can fail to find meaningful centres. In that case, fallback to a coarser grid-based peak detection to ensure the algorithm still produces a reasonable result instead of zero centres.
  const needsFallback = (
    points.length < 12
    || rawPeaks.length === 0
    || rawPeaks.length > Math.max(4, Math.floor(points.length / 2))
  );
  const fallbackPeaks = needsFallback ? detectFallbackGridPeaks(points, bandwidthKm) : [];
  const peakSeeds = mergePeaks(
    needsFallback && fallbackPeaks.length > 0 ? fallbackPeaks : rawPeaks,
    bandwidthKm,
  );
  const effectivePeaks = peakSeeds.length > 0
    ? peakSeeds
    : [{
      xKm: points[0]!.xKm,
      yKm: points[0]!.yKm,
      longitude: points[0]!.longitude,
      latitude: points[0]!.latitude,
      potential: potentials[0] ?? points[0]!.mass,
    }];

  const initialAssignments = assignPointsToPeaks(points, effectivePeaks, bandwidthKm)
    .sort((a, b) => b.assignedMass - a.assignedMass);

  const minShare = MIN_CENTER_SHARE;
  const minPointCount = MIN_POINTS_PER_CENTER;

  // Drop weak secondary peaks so tiny stray clusters do not get promoted into
  // full centres on low-detail or noisy maps.
  const filteredPeaks = initialAssignments
    .filter((assignment, assignmentIndex) => {
      if (assignmentIndex === 0) return true;
      const share = assignment.assignedMass / totalMass;
      return share >= minShare && assignment.assignedPointCount >= minPointCount;
    })
    .map((assignment) => assignment.seed);

  const finalAssignments = assignPointsToPeaks(
    points,
    filteredPeaks.length > 0 ? filteredPeaks : [initialAssignments[0]!.seed],
    bandwidthKm,
  )
    .filter((assignment) => assignment.assignedMass > 0)
    .sort((a, b) => b.assignedMass - a.assignedMass);

  const centerShares = finalAssignments.map((assignment) => assignment.assignedMass / totalMass);
  const hhi = centerShares.reduce((sum, share) => sum + (share * share), 0);
  const detectedCenterCount = finalAssignments.length;
  const effectiveCenterCount = hhi > 0 ? 1 / hhi : 0;
  // Translate centre mass balance into a bounded headline score: one dominant
  // centre approaches 0, while multiple balanced centres approach 1.
  const score = detectedCenterCount <= 1
    ? 0
    : clamp((1 - hhi) / (1 - (1 / detectedCenterCount)), 0, 1);
  const largestCenterShare = centerShares[0] ?? 0;

  let minimumCenterSeparationKm = bandwidthKm * 2;
  if (finalAssignments.length > 1) {
    minimumCenterSeparationKm = Number.POSITIVE_INFINITY;
    for (let firstIndex = 0; firstIndex < finalAssignments.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < finalAssignments.length; secondIndex += 1) {
        const firstAssignment = finalAssignments[firstIndex]!;
        const secondAssignment = finalAssignments[secondIndex]!;
        minimumCenterSeparationKm = Math.min(
          minimumCenterSeparationKm,
          distanceKm(firstAssignment.seed, secondAssignment.seed),
        );
      }
    }
  }

  const effectivePointCount = computeEffectivePointCount(points);
  const sampleScore = clamp((points.length - 4) / 40, 0, 1);
  const effectivePointScore = clamp((effectivePointCount - 2) / 18, 0, 1);
  const separationScore = clamp(minimumCenterSeparationKm / (bandwidthKm * 2), 0, 1);
  const bandwidthScore = clamp(baseSpacingKm > 0 ? (baseSpacingKm / bandwidthKm) * 2 : 0.5, 0, 1);
  const fallbackPenalty = needsFallback ? 0.85 : 1;
  // Reliability is a support signal, not the polycentrism score itself. It
  // indicates how much trust to place in the detected centre structure.
  const reliabilityScore = clamp(
    ((sampleScore + effectivePointScore + separationScore + bandwidthScore) / 4) * fallbackPenalty,
    0,
    1,
  );

  return {
    score,
    detectedCenterCount,
    effectiveCenterCount,
    largestCenterShare,
    bandwidthKm,
    reliabilityScore,
    supportLevel: classifySupportLevel(reliabilityScore),
    usedFallback: needsFallback,
    topCenters: finalAssignments.slice(0, MAX_TOP_CENTERS).map((assignment) => ({
      longitude: assignment.assignedMass > 0
        ? assignment.longitudeMass / assignment.assignedMass
        : assignment.seed.longitude,
      latitude: assignment.assignedMass > 0
        ? assignment.latitudeMass / assignment.assignedMass
        : assignment.seed.latitude,
      massShare: assignment.assignedMass / totalMass,
      assignedMass: assignment.assignedMass,
      assignedPointCount: assignment.assignedPointCount,
    })),
  };
}

// Compute polycentrism metrics for a given demand data set for both residents and overall activity (residents + jobs).
export function computePolycentrismMetrics(
  demandData: DemandData,
  detailMetrics?: PolycentrismDetailMetrics,
): PolycentrismMetrics {
  return {
    residents: buildVariantMetrics(demandData, detailMetrics, "residents"),
    activity: buildVariantMetrics(demandData, detailMetrics, "activity"),
  };
}
