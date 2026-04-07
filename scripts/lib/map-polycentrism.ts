import type { DemandData } from "./map-analytics-grid.js";

// This module is mostly for fun attempt at polycentrism metrics, and is not currently wired into the app. The main exported function computePolycentrismMetrics takes the same demand data as the grid metrics and produces a set of metrics about how polycentric the overall activity pattern is, based on spatial clustering of demand points. 
// The core logic identifies local peaks in a smoothed potential surface derived from the demand points, then applies a series of gates to determine which peaks count as distinct centers based on their relative prominence, mass, and spacing. 

export interface PolycentrismCenter {
  longitude: number;
  latitude: number;
  massShare: number;
  assignedMass: number;
  assignedPointCount: number;
  prominenceRatio: number;
}

export interface PolycentrismRejectedCenter extends PolycentrismCenter {
  strongestCompetitorDistanceKm: number | null;
  strongestCompetitorPotential: number | null;
  localConsolidatedShare: number;
  localConsolidatedMass: number;
  localContributorCount: number;
  localContributorDistancesKm: number[];
  rejectionReasons: string[];
}

export interface PolycentrismDebugMetrics {
  rawPeakCount: number;
  mergedPeakCount: number;
  filteredPeakCount: number;
  prominenceThreshold: number;
  minPointsPerCenter: number;
  rejectedCenters: PolycentrismRejectedCenter[];
}

export interface PolycentrismVariantMetrics {
  score: number;
  continuousScore: number;
  detectedCenterCount: number;
  effectiveCenterCount: number;
  largestCenterShare: number;
  bandwidthKm: number;
  reliabilityScore: number;
  supportLevel: "low" | "medium" | "high";
  usedFallback: boolean;
  topCenters: PolycentrismCenter[];
  debug: PolycentrismDebugMetrics;
}

export interface PolycentrismMetrics {
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

interface ProminenceAssessment {
  prominenceRatio: number;
  strongestCompetitorDistanceKm: number | null;
  strongestCompetitorPotential: number | null;
}

interface CenterDistanceAssessment {
  nearestKeptDistanceKm: number | null;
}

interface CenterGateConfig {
  // Centers at or above this share are treated as major centers and only fail
  // if they are implausibly close to a stronger kept center.
  protectedCenterShareFloor: number;
  // Minimum spacing required for a major center to survive; prevents obvious
  // duplicate cores from both being kept.
  protectedCenterCloseDistanceKm: number;
  // Centers above this share pass once they meet prominence and point-count
  // requirements, even if they are not in the fully protected tier.
  strongCenterShareFloor: number;
  // Minimum standalone share for a smaller secondary center to be considered by
  // the low-share branch at all.
  lowShareCenterFloor: number;
  // Lower bound relative to the weakest already-kept center; stops the tail
  // from growing with many much smaller follow-on centers.
  lowShareRelativeToSmallestKept: number;
  // Minimum separation required for a smaller center; low-share centers are
  // only kept when they are meaningfully distinct in space.
  lowShareMinDistanceToKeptKm: number;
}

const FIXED_POLYCENTRISM_BANDWIDTH_KM = 1.3;
const GAUSSIAN_DISTANCE_MULTIPLIER = 3;
const MAX_TOP_CENTERS = 8;
const EARTH_RADIUS_KM = 6371.0088;
const DEGREES_TO_RADIANS = Math.PI / 180;
const KILOMETERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;
// Secondary centres must retain enough local independence from stronger kept
// peaks to survive the final prominence-based cull.
const MIN_PROMINENCE_RATIO = 0.22;
// Require at least ten assigned points for a stable secondary centre.
const MIN_POINTS_PER_CENTER = 10;
// When a metro is split into several nearby fragments, accumulate neighboring
// post-merge basins within this radius before evaluating the low-share gate.
const LOCAL_CONSOLIDATION_RADIUS_KM = 15;
// Ignore tiny local fragments during consolidation so the low-share branch does
// not sweep in noise just because it is spatially nearby.
const LOCAL_CONSOLIDATION_MIN_NEIGHBOR_SHARE = 0.02;
const CONTINUOUS_SCORE_DISTANCE_SCALE_KM = 10;
const MAX_LOCAL_CONTRIBUTOR_DISTANCES = 6;
const ACTIVITY_CENTER_GATE: CenterGateConfig = {
  protectedCenterShareFloor: 0.15,
  protectedCenterCloseDistanceKm: 8,
  strongCenterShareFloor: 0.14,
  lowShareCenterFloor: 0.06,
  lowShareRelativeToSmallestKept: 0.42,
  lowShareMinDistanceToKeptKm: 12,
};
// Base comparison radius for deciding whether a local maximum is genuinely
// distinct from a nearby stronger potential peak.
const BASE_COMPARISON_RADIUS_MULTIPLIER = 1.5;
// Weaker candidate peaks should be suppressed across a wider neighborhood when
// a much stronger peak is nearby, while similarly strong peaks only compare at
// roughly the base radius.
const COMPARISON_RADIUS_EXPANSION_FACTOR = 1.25;
const COMPARISON_RADIUS_EXPONENTIAL_ALPHA = 3;
// Base merge radius for nearby local maxima before dominance-aware expansion.
const BASE_MERGE_DISTANCE_MULTIPLIER = 1.5;
// Weaker peaks merge more aggressively into stronger peaks. Comparable peaks
// keep a radius near the base value, while weak bumps near a dominant centre
// get a substantially larger merge radius.
const MERGE_RADIUS_EXPANSION_FACTOR = 1.25;
const MERGE_RADIUS_EXPONENTIAL_ALPHA = 3;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(value, maxValue));
}

function emptyVariantMetrics(): PolycentrismVariantMetrics {
  return {
    score: 0,
    continuousScore: 0,
    detectedCenterCount: 0,
    effectiveCenterCount: 0,
    largestCenterShare: 0,
    bandwidthKm: 0,
    reliabilityScore: 0,
    supportLevel: "low",
    usedFallback: false,
    topCenters: [],
    debug: {
      rawPeakCount: 0,
      mergedPeakCount: 0,
      filteredPeakCount: 0,
      prominenceThreshold: MIN_PROMINENCE_RATIO,
      minPointsPerCenter: MIN_POINTS_PER_CENTER,
      rejectedCenters: [],
    },
  };
}

function computeAdaptiveMergeRadiusKm(
  strongerPeak: PeakSeed,
  weakerPeak: PeakSeed,
  bandwidthKm: number,
): number {
  const baseMergeRadiusKm = bandwidthKm * BASE_MERGE_DISTANCE_MULTIPLIER;
  if (strongerPeak.potential <= 0 || weakerPeak.potential <= 0) {
    return baseMergeRadiusKm;
  }

  const weakerToStrongerRatio = clamp(weakerPeak.potential / strongerPeak.potential, 0, 1);
  const expansionMultiplier = 1 + (
    MERGE_RADIUS_EXPANSION_FACTOR
    * Math.exp(-MERGE_RADIUS_EXPONENTIAL_ALPHA * weakerToStrongerRatio)
  );
  return baseMergeRadiusKm * expansionMultiplier;
}

function computeAdaptiveComparisonRadiusKm(
  firstPotential: number,
  secondPotential: number,
  bandwidthKm: number,
): number {
  const baseComparisonRadiusKm = bandwidthKm * BASE_COMPARISON_RADIUS_MULTIPLIER;
  if (firstPotential <= 0 || secondPotential <= 0) {
    return baseComparisonRadiusKm;
  }

  const strongerPotential = Math.max(firstPotential, secondPotential);
  const weakerPotential = Math.min(firstPotential, secondPotential);
  const weakerToStrongerRatio = clamp(weakerPotential / strongerPotential, 0, 1);
  const expansionMultiplier = 1 + (
    COMPARISON_RADIUS_EXPANSION_FACTOR
    * Math.exp(-COMPARISON_RADIUS_EXPONENTIAL_ALPHA * weakerToStrongerRatio)
  );
  return baseComparisonRadiusKm * expansionMultiplier;
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
  const cellSizeKm = bandwidthKm;
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
  const cellSizeKm = bandwidthKm;
  const baseComparisonRadiusKm = bandwidthKm * BASE_COMPARISON_RADIUS_MULTIPLIER;
  const maxComparisonRadiusKm = baseComparisonRadiusKm * (1 + COMPARISON_RADIUS_EXPANSION_FACTOR);
  const index = buildSpatialIndex(points, cellSizeKm);

  const peaks: PeakSeed[] = [];
  points.forEach((point, pointIndex) => {
    const neighborIndexes = getNeighborIndexes(point, cellSizeKm, maxComparisonRadiusKm, index);
    const pointPotential = potentials[pointIndex] ?? 0;
    let isPeak = true;
    for (const neighborIndex of neighborIndexes) {
      if (neighborIndex === pointIndex) continue;
      const neighbor = points[neighborIndex]!;
      const neighborPotential = potentials[neighborIndex] ?? 0;
      const comparisonRadiusKm = computeAdaptiveComparisonRadiusKm(
        pointPotential,
        neighborPotential,
        bandwidthKm,
      );
      if (squaredDistanceKm(point, neighbor) > comparisonRadiusKm * comparisonRadiusKm) continue;
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
  // Coarsen the space into broader cells and detect peaks on that aggregated
  // surface instead of raw point potentials when the raw peak field is noisy.
  const cellSizeKm = bandwidthKm;
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

  const fallbackBandwidthKm = bandwidthKm * 1.15;
  const potentials = computePotentials(coarsePoints, fallbackBandwidthKm);
  return detectPointPeaks(coarsePoints, potentials, fallbackBandwidthKm);
}

function mergePeaks(peaks: PeakSeed[], bandwidthKm: number): PeakSeed[] {
  if (peaks.length <= 1) return peaks;
  const sortedPeaks = [...peaks].sort((a, b) => b.potential - a.potential);
  const merged: PeakSeed[] = [];

  // Nearby local maxima usually belong to the same centre; keep the strongest
  // one so downstream centre counts are not inflated by tiny local wiggles.
  for (const peak of sortedPeaks) {
    const overlaps = merged.some((existingPeak) => {
      const strongerPeak = existingPeak.potential >= peak.potential ? existingPeak : peak;
      const weakerPeak = strongerPeak === existingPeak ? peak : existingPeak;
      const adaptiveMergeRadiusKm = computeAdaptiveMergeRadiusKm(strongerPeak, weakerPeak, bandwidthKm);
      return distanceKm(peak, existingPeak) <= adaptiveMergeRadiusKm;
    });
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
  const assignmentBandwidthKm = bandwidthKm * 1.2;

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

function assessPeakProminence(
  candidatePeak: PeakSeed,
  keptPeaks: PeakSeed[],
  bandwidthKm: number,
): ProminenceAssessment {
  if (keptPeaks.length === 0 || candidatePeak.potential <= 0) {
    return {
      prominenceRatio: 1,
      strongestCompetitorDistanceKm: null,
      strongestCompetitorPotential: null,
    };
  }

  let strongestCompetitorInfluence = 0;
  let strongestCompetitorDistanceKm: number | null = null;
  let strongestCompetitorPotential: number | null = null;

  for (const keptPeak of keptPeaks) {
    const competitorDistanceKm = distanceKm(candidatePeak, keptPeak);
    const competitorInfluence = keptPeak.potential * gaussianWeight(competitorDistanceKm, bandwidthKm);
    if (competitorInfluence <= strongestCompetitorInfluence) {
      continue;
    }
    strongestCompetitorInfluence = competitorInfluence;
    strongestCompetitorDistanceKm = competitorDistanceKm;
    strongestCompetitorPotential = keptPeak.potential;
  }

  return {
    prominenceRatio: clamp(1 - (strongestCompetitorInfluence / candidatePeak.potential), 0, 1),
    strongestCompetitorDistanceKm,
    strongestCompetitorPotential,
  };
}

function assessDistanceToKeptCenters(
  candidatePeak: PeakSeed,
  keptPeaks: PeakSeed[],
): CenterDistanceAssessment {
  if (keptPeaks.length === 0) {
    return {
      nearestKeptDistanceKm: null,
    };
  }

  let nearestKeptDistanceKm = Number.POSITIVE_INFINITY;
  for (const keptPeak of keptPeaks) {
    nearestKeptDistanceKm = Math.min(
      nearestKeptDistanceKm,
      distanceKm(candidatePeak, keptPeak),
    );
  }

  return {
    nearestKeptDistanceKm: Number.isFinite(nearestKeptDistanceKm)
      ? nearestKeptDistanceKm
      : null,
  };
}

interface LocalConsolidationAssessment {
  consolidatedMass: number;
  consolidatedShare: number;
  contributorCount: number;
  contributorDistancesKm: number[];
  isDominantLocalPeak: boolean;
}

function assessLocalConsolidation(
  candidateAssignment: CenterAssignment,
  allAssignments: CenterAssignment[],
  keptAssignments: CenterAssignment[],
  totalMass: number,
): LocalConsolidationAssessment {
  let isDominantLocalPeak = true;
  for (const neighborAssignment of allAssignments) {
    if (neighborAssignment === candidateAssignment) continue;
    if (neighborAssignment.assignedPointCount < MIN_POINTS_PER_CENTER) continue;

    const neighborShare = neighborAssignment.assignedMass / totalMass;
    if (neighborShare < LOCAL_CONSOLIDATION_MIN_NEIGHBOR_SHARE) continue;

    const candidateDistanceKm = distanceKm(candidateAssignment.seed, neighborAssignment.seed);
    if (candidateDistanceKm > LOCAL_CONSOLIDATION_RADIUS_KM) continue;

    if (neighborAssignment.assignedMass > candidateAssignment.assignedMass) {
      isDominantLocalPeak = false;
      break;
    }
    if (
      neighborAssignment.assignedMass === candidateAssignment.assignedMass
      && neighborAssignment.seed.potential > candidateAssignment.seed.potential
    ) {
      isDominantLocalPeak = false;
      break;
    }
  }

  if (!isDominantLocalPeak) {
    return {
      consolidatedMass: candidateAssignment.assignedMass,
      consolidatedShare: totalMass > 0 ? candidateAssignment.assignedMass / totalMass : 0,
      contributorCount: 1,
      contributorDistancesKm: [],
      isDominantLocalPeak: false,
    };
  }

  let consolidatedMass = candidateAssignment.assignedMass;
  const contributorDistancesKm: number[] = [];

  for (const neighborAssignment of allAssignments) {
    if (neighborAssignment === candidateAssignment) continue;
    if (neighborAssignment.assignedPointCount < MIN_POINTS_PER_CENTER) continue;

    const neighborShare = neighborAssignment.assignedMass / totalMass;
    if (neighborShare < LOCAL_CONSOLIDATION_MIN_NEIGHBOR_SHARE) continue;

    const candidateDistanceKm = distanceKm(candidateAssignment.seed, neighborAssignment.seed);
    if (candidateDistanceKm > LOCAL_CONSOLIDATION_RADIUS_KM) continue;

    let blockedByKeptCenter = false;
    for (const keptAssignment of keptAssignments) {
      const keptDistanceKm = distanceKm(keptAssignment.seed, neighborAssignment.seed);
      if (keptDistanceKm < candidateDistanceKm) {
        blockedByKeptCenter = true;
        break;
      }
    }

    if (blockedByKeptCenter) continue;

    consolidatedMass += neighborAssignment.assignedMass;
    contributorDistancesKm.push(candidateDistanceKm);
  }

  contributorDistancesKm.sort((a, b) => a - b);
  return {
    consolidatedMass,
    consolidatedShare: totalMass > 0 ? consolidatedMass / totalMass : 0,
    contributorCount: 1 + contributorDistancesKm.length,
    contributorDistancesKm: contributorDistancesKm.slice(0, MAX_LOCAL_CONTRIBUTOR_DISTANCES),
    isDominantLocalPeak: true,
  };
}

function getAssignmentLongitude(assignment: CenterAssignment): number {
  return assignment.assignedMass > 0
    ? assignment.longitudeMass / assignment.assignedMass
    : assignment.seed.longitude;
}

function getAssignmentLatitude(assignment: CenterAssignment): number {
  return assignment.assignedMass > 0
    ? assignment.latitudeMass / assignment.assignedMass
    : assignment.seed.latitude;
}

function computeContinuousPolycentrismScore(
  assignments: CenterAssignment[],
  totalMass: number,
): number {
  const qualifyingAssignments = assignments.filter((assignment) => (
    assignment.assignedPointCount >= MIN_POINTS_PER_CENTER
    && totalMass > 0
    && (assignment.assignedMass / totalMass) >= LOCAL_CONSOLIDATION_MIN_NEIGHBOR_SHARE
  ));

  if (qualifyingAssignments.length < 2) {
    return 0;
  }

  const qualifyingMass = qualifyingAssignments.reduce(
    (sum, assignment) => sum + assignment.assignedMass,
    0,
  );
  if (qualifyingMass <= 0) {
    return 0;
  }

  const normalizedShares = qualifyingAssignments.map((assignment) => assignment.assignedMass / qualifyingMass);
  const hhi = normalizedShares.reduce((sum, share) => sum + (share * share), 0);
  const effectiveCenterCount = hhi > 0 ? 1 / hhi : 0;
  const effectiveCountTerm = clamp(effectiveCenterCount - 1, 0, 1);

  let weightedSeparationSum = 0;
  let pairWeightSum = 0;
  for (let firstIndex = 0; firstIndex < qualifyingAssignments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < qualifyingAssignments.length; secondIndex += 1) {
      const firstAssignment = qualifyingAssignments[firstIndex]!;
      const secondAssignment = qualifyingAssignments[secondIndex]!;
      const pairWeight = normalizedShares[firstIndex]! * normalizedShares[secondIndex]!;
      const pairDistanceKm = distanceKm(firstAssignment.seed, secondAssignment.seed);
      const separationDiscount = 1 - Math.exp(
        -((pairDistanceKm / CONTINUOUS_SCORE_DISTANCE_SCALE_KM) ** 2),
      );
      weightedSeparationSum += pairWeight * separationDiscount;
      pairWeightSum += pairWeight;
    }
  }

  if (pairWeightSum <= 0) {
    return 0;
  }

  const weightedSeparation = weightedSeparationSum / pairWeightSum;
  return clamp(effectiveCountTerm * weightedSeparation, 0, 1);
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

function computeBandwidthKm(): number {
  return FIXED_POLYCENTRISM_BANDWIDTH_KM;
}

function buildVariantMetrics(
  demandData: DemandData,
  massForPoint: (point: DemandData["points"][number]) => number,
): PolycentrismVariantMetrics {
  // Polycentrism is now tracked only for overall activity so the center model
  // stays focused on the mixed resident/job structure the app actually uses.
  const points = buildProjectedPoints(demandData, massForPoint);
  if (points.length === 0) return emptyVariantMetrics();

  const totalMass = points.reduce((sum, point) => sum + point.mass, 0);
  if (totalMass <= 0) return emptyVariantMetrics();

  const bandwidthKm = computeBandwidthKm();
  const centerGateConfig = ACTIVITY_CENTER_GATE;
  const potentials = computePotentials(points, bandwidthKm);
  const rawPeaks = detectPointPeaks(points, potentials, bandwidthKm);

  // If the raw peak field is empty or excessively noisy, fallback to a coarser
  // grid-based peak detection instead of trusting the raw local maxima.
  const needsFallback = (
    rawPeaks.length === 0
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

  const initialAssignments = assignPointsToPeaks(points, effectivePeaks, bandwidthKm);
  const continuousScore = computeContinuousPolycentrismScore(initialAssignments, totalMass);
  const minPointCount = MIN_POINTS_PER_CENTER;

  // Keep the strongest peak, then only accept later peaks if they remain
  // locally prominent against the already-kept stronger centres.
  const rejectedCenters: PolycentrismRejectedCenter[] = [];
  const filteredAssignments: Array<CenterAssignment & { prominence: ProminenceAssessment }> = [];
  for (const [assignmentIndex, assignment] of initialAssignments.entries()) {
    const keptSeeds = filteredAssignments.map((keptAssignment) => keptAssignment.seed);
    const prominence = assessPeakProminence(
      assignment.seed,
      keptSeeds,
      bandwidthKm,
    );
    const distanceAssessment = assessDistanceToKeptCenters(assignment.seed, keptSeeds);
    if (assignmentIndex === 0) {
      filteredAssignments.push({ ...assignment, prominence });
      continue;
    }

    const share = assignment.assignedMass / totalMass;
    const localConsolidation = assessLocalConsolidation(
      assignment,
      initialAssignments,
      filteredAssignments,
      totalMass,
    );
    const rejectionReasons: string[] = [];
    if (assignment.assignedPointCount < minPointCount) {
      rejectionReasons.push("below_min_points_per_center");
    }
    if (prominence.prominenceRatio < MIN_PROMINENCE_RATIO) {
      rejectionReasons.push("below_prominence_threshold");
    }
    if (rejectionReasons.length === 0) {
      if (share >= centerGateConfig.protectedCenterShareFloor) {
        if (
          distanceAssessment.nearestKeptDistanceKm !== null
          && distanceAssessment.nearestKeptDistanceKm < centerGateConfig.protectedCenterCloseDistanceKm
        ) {
          rejectionReasons.push("too_close_for_protected_share_center");
        }
      }
      else if (share >= centerGateConfig.strongCenterShareFloor) {
        // Strong prominent centers pass the hybrid gate directly.
      }
      else if (localConsolidation.consolidatedShare >= centerGateConfig.lowShareCenterFloor) {
        if (!localConsolidation.isDominantLocalPeak) {
          rejectionReasons.push("not_dominant_local_peak");
        }
        const smallestKeptShare = Math.min(
          ...filteredAssignments.map((keptAssignment) => keptAssignment.assignedMass / totalMass),
        );
        if (
          localConsolidation.consolidatedShare
          < (smallestKeptShare * centerGateConfig.lowShareRelativeToSmallestKept)
        ) {
          rejectionReasons.push("below_relative_share_floor");
        }
        if (
          distanceAssessment.nearestKeptDistanceKm !== null
          && distanceAssessment.nearestKeptDistanceKm < centerGateConfig.lowShareMinDistanceToKeptKm
        ) {
          rejectionReasons.push("too_close_for_low_share_center");
        }
      }
      else {
        rejectionReasons.push("below_secondary_share_floor");
      }
    }
    if (rejectionReasons.length > 0) {
      rejectedCenters.push({
        longitude: getAssignmentLongitude(assignment),
        latitude: getAssignmentLatitude(assignment),
        massShare: share,
        assignedMass: assignment.assignedMass,
        assignedPointCount: assignment.assignedPointCount,
        prominenceRatio: prominence.prominenceRatio,
        strongestCompetitorDistanceKm: distanceAssessment.nearestKeptDistanceKm,
        strongestCompetitorPotential: prominence.strongestCompetitorPotential,
        localConsolidatedShare: localConsolidation.consolidatedShare,
        localConsolidatedMass: localConsolidation.consolidatedMass,
        localContributorCount: localConsolidation.contributorCount,
        localContributorDistancesKm: localConsolidation.contributorDistancesKm,
        rejectionReasons,
      });
      continue;
    }
    filteredAssignments.push({ ...assignment, prominence });
  }
  const filteredPeaks = filteredAssignments.map((assignment) => assignment.seed);

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
  const bandwidthScore = 1;
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
    continuousScore,
    detectedCenterCount,
    effectiveCenterCount,
    largestCenterShare,
    bandwidthKm,
    reliabilityScore,
    supportLevel: classifySupportLevel(reliabilityScore),
    usedFallback: needsFallback,
    topCenters: finalAssignments.slice(0, MAX_TOP_CENTERS).map((assignment) => {
      const prominence = assessPeakProminence(
        assignment.seed,
        finalAssignments
          .filter((candidate) => candidate.seed.potential > assignment.seed.potential)
          .map((candidate) => candidate.seed),
        bandwidthKm,
      );
      return {
        longitude: getAssignmentLongitude(assignment),
        latitude: getAssignmentLatitude(assignment),
        massShare: assignment.assignedMass / totalMass,
        assignedMass: assignment.assignedMass,
        assignedPointCount: assignment.assignedPointCount,
        prominenceRatio: prominence.prominenceRatio,
      };
    }),
    debug: {
      rawPeakCount: rawPeaks.length,
      mergedPeakCount: peakSeeds.length,
      filteredPeakCount: filteredPeaks.length > 0 ? filteredPeaks.length : 1,
      prominenceThreshold: MIN_PROMINENCE_RATIO,
      minPointsPerCenter: minPointCount,
      rejectedCenters,
    },
  };
}

// Compute polycentrism metrics for overall activity (residents + jobs).
export function computePolycentrismMetrics(demandData: DemandData): PolycentrismMetrics {
  return {
    activity: buildVariantMetrics(demandData, (point) => point.residents + point.jobs),
  };
}
