import test from "node:test";
import assert from "node:assert/strict";
import { computePolycentrismMetrics } from "../lib/map-polycentrism.js";
import type { DemandData } from "../lib/map-analytics-grid.js";

function buildDemandData(points: Array<{
  location: [number, number];
  residents: number;
  jobs?: number;
}>): DemandData {
  return {
    points: points.map((point, index) => ({
      id: `pt${index + 1}`,
      location: point.location,
      residents: point.residents,
      jobs: point.jobs ?? 0,
    })),
    pops: [],
  };
}

function buildCluster(
  center: [number, number],
  count: number,
  residents: number,
  jobs: number,
): Array<{
  location: [number, number];
  residents: number;
  jobs: number;
}> {
  const offsets: Array<[number, number]> = [
    [0, 0],
    [0.002, 0.001],
    [-0.002, 0.001],
    [0.001, -0.002],
    [-0.001, -0.002],
    [0.003, 0],
    [-0.003, 0],
    [0, 0.003],
    [0, -0.003],
    [0.0025, -0.0015],
    [-0.0025, 0.0015],
    [0.0015, 0.0025],
  ];

  return Array.from({ length: count }, (_, index) => {
    const [offsetLon, offsetLat] = offsets[index % offsets.length]!;
    const residentAdjustment = index % 3;
    const jobAdjustment = index % 2;
    return {
      location: [center[0] + offsetLon, center[1] + offsetLat],
      residents: residents - residentAdjustment,
      jobs: jobs - jobAdjustment,
    };
  });
}

test("computePolycentrismMetrics returns a near-monocentric score for a single dense basin", () => {
  const demandData = buildDemandData([
    { location: [0, 0], residents: 40, jobs: 20 },
    { location: [0.004, 0.002], residents: 35, jobs: 15 },
    { location: [0.006, -0.003], residents: 25, jobs: 10 },
    { location: [-0.005, 0.001], residents: 20, jobs: 8 },
  ]);

  const polycentrism = computePolycentrismMetrics(demandData);

  assert.equal(polycentrism.activity.detectedCenterCount, 1);
  assert.equal(polycentrism.activity.score, 0);
  assert.equal(polycentrism.activity.continuousScore, 0);
});

test("computePolycentrismMetrics detects two balanced centres", () => {
  const demandData = buildDemandData([
    ...buildCluster([0, 0], 12, 30, 10),
    ...buildCluster([0.08, 0.08], 12, 30, 10),
  ]);

  const polycentrism = computePolycentrismMetrics(demandData);

  assert.equal(polycentrism.activity.detectedCenterCount, 2);
  assert.ok(polycentrism.activity.score > 0.8);
  assert.ok(polycentrism.activity.continuousScore > 0.5);
  assert.ok(polycentrism.activity.effectiveCenterCount > 1.8);
  assert.ok(Math.abs((polycentrism.activity.topCenters[0]?.massShare ?? 0) - 0.5) < 0.2);
});

test("computePolycentrismMetrics scores a three-centre layout above monocentric and below balanced two-centre", () => {
  const monocentric = computePolycentrismMetrics(buildDemandData([
    { location: [0, 0], residents: 50, jobs: 20 },
    { location: [0.004, 0.002], residents: 30, jobs: 10 },
    { location: [-0.004, -0.002], residents: 20, jobs: 8 },
  ]));

  const balanced = computePolycentrismMetrics(buildDemandData([
    ...buildCluster([0, 0], 12, 30, 10),
    ...buildCluster([0.08, 0.08], 12, 30, 10),
  ]));

  const nakaumiStyle = computePolycentrismMetrics(buildDemandData([
    ...buildCluster([0, 0], 12, 26, 10),
    ...buildCluster([0.08, 0.02], 12, 24, 9),
    ...buildCluster([0.03, 0.09], 12, 18, 6),
  ]));

  assert.ok(nakaumiStyle.activity.detectedCenterCount >= 3);
  assert.ok(nakaumiStyle.activity.score > monocentric.activity.score + 0.3);
  assert.ok(nakaumiStyle.activity.score < balanced.activity.score);
  assert.ok(nakaumiStyle.activity.continuousScore > monocentric.activity.continuousScore + 0.2);
  assert.ok(nakaumiStyle.activity.continuousScore < balanced.activity.continuousScore);
});

test("computePolycentrismMetrics consolidates fragmented nearby basins into two centers", () => {
  const fragmentedDemandData = buildDemandData([
    ...buildCluster([0, 0], 10, 20, 8),
    ...buildCluster([0.012, 0.004], 8, 14, 6),
    ...buildCluster([0.085, 0.085], 10, 20, 8),
    ...buildCluster([0.098, 0.092], 8, 14, 6),
    { location: [0.22, 0.22], residents: 1, jobs: 0 },
    { location: [-0.2, 0.18], residents: 1, jobs: 0 },
  ]);

  const polycentrism = computePolycentrismMetrics(fragmentedDemandData);

  assert.equal(polycentrism.activity.detectedCenterCount, 2);
  assert.ok(polycentrism.activity.topCenters.every((center) => center.massShare > 0.3));
  assert.ok(polycentrism.activity.continuousScore > 0.5);
});

test("computePolycentrismMetrics collapses widely separated low-mass noise centres and reports lower support", () => {
  const noisyDemandData = buildDemandData([
    { location: [0, 0], residents: 40, jobs: 15 },
    { location: [0.006, 0.003], residents: 35, jobs: 10 },
    { location: [0.01, -0.004], residents: 30, jobs: 12 },
    { location: [0.3, 0.3], residents: 2, jobs: 0 },
    { location: [-0.28, 0.27], residents: 2, jobs: 0 },
    { location: [0.25, -0.26], residents: 2, jobs: 0 },
  ]);

  const polycentrism = computePolycentrismMetrics(noisyDemandData);

  assert.ok(polycentrism.activity.detectedCenterCount <= 2);
  assert.ok(polycentrism.activity.reliabilityScore < 0.7);
  assert.ok(["low", "medium"].includes(polycentrism.activity.supportLevel));
  assert.ok(polycentrism.activity.continuousScore < 0.2);
});

test("computePolycentrismMetrics uses the fixed activity bandwidth", () => {
  const sparseDemandData = buildDemandData([
    { location: [0, 0], residents: 20, jobs: 5 },
    { location: [0.12, 0.12], residents: 18, jobs: 4 },
    { location: [0.24, 0.24], residents: 16, jobs: 3 },
  ]);

  const defaultPolycentrism = computePolycentrismMetrics(sparseDemandData);

  assert.equal(defaultPolycentrism.activity.bandwidthKm, 1.3);
  assert.ok(defaultPolycentrism.activity.continuousScore >= 0);
  assert.ok(defaultPolycentrism.activity.continuousScore <= 1);
});

test("computePolycentrismMetrics annotates centres and rejected noise with prominence diagnostics", () => {
  const demandData = buildDemandData([
    ...buildCluster([0, 0], 16, 32, 10),
    ...buildCluster([0.09, 0.09], 12, 29, 10),
    { location: [0.3, 0.3], residents: 2, jobs: 0 },
    { location: [-0.28, 0.27], residents: 2, jobs: 0 },
    { location: [0.25, -0.26], residents: 2, jobs: 0 },
  ]);

  const polycentrism = computePolycentrismMetrics(demandData);

  assert.equal(polycentrism.activity.detectedCenterCount, 2);
  assert.ok(polycentrism.activity.topCenters.every((center) => center.prominenceRatio >= 0.22));
  assert.ok(polycentrism.activity.continuousScore >= 0);
  assert.ok(polycentrism.activity.continuousScore <= 1);
  assert.ok(polycentrism.activity.debug.rejectedCenters.length > 0);
  assert.ok(polycentrism.activity.debug.rejectedCenters.every((center) => (
    center.strongestCompetitorDistanceKm !== null
    && center.strongestCompetitorPotential !== null
    && center.prominenceRatio >= 0
    && center.prominenceRatio <= 1
  )));
});
