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

test("computePolycentrismMetrics returns a near-monocentric score for a single dense basin", () => {
  const demandData = buildDemandData([
    { location: [0, 0], residents: 40, jobs: 20 },
    { location: [0.004, 0.002], residents: 35, jobs: 15 },
    { location: [0.006, -0.003], residents: 25, jobs: 10 },
    { location: [-0.005, 0.001], residents: 20, jobs: 8 },
  ]);

  const polycentrism = computePolycentrismMetrics(demandData, {
    residentWeightedNearestNeighborKm: { p50: 0.8 },
    workerWeightedNearestNeighborKm: { p50: 0.8 },
  });

  assert.equal(polycentrism.residents.detectedCenterCount, 1);
  assert.equal(polycentrism.activity.detectedCenterCount, 1);
  assert.equal(polycentrism.residents.score, 0);
  assert.equal(polycentrism.activity.score, 0);
});

test("computePolycentrismMetrics detects two balanced centres", () => {
  const demandData = buildDemandData([
    { location: [0, 0], residents: 30, jobs: 10 },
    { location: [0.004, 0.002], residents: 25, jobs: 12 },
    { location: [-0.004, -0.001], residents: 28, jobs: 8 },
    { location: [0.08, 0.08], residents: 32, jobs: 11 },
    { location: [0.084, 0.082], residents: 26, jobs: 10 },
    { location: [0.076, 0.079], residents: 29, jobs: 9 },
  ]);

  const polycentrism = computePolycentrismMetrics(demandData, {
    residentWeightedNearestNeighborKm: { p50: 0.7 },
    workerWeightedNearestNeighborKm: { p50: 0.7 },
  });

  assert.equal(polycentrism.residents.detectedCenterCount, 2);
  assert.ok(polycentrism.residents.score > 0.8);
  assert.ok(polycentrism.residents.effectiveCenterCount > 1.8);
  assert.ok(Math.abs((polycentrism.residents.topCenters[0]?.massShare ?? 0) - 0.5) < 0.2);
});

test("computePolycentrismMetrics scores a Nakaumi-style three-centre layout above monocentric and below balanced two-centre", () => {
  const monocentric = computePolycentrismMetrics(buildDemandData([
    { location: [0, 0], residents: 50, jobs: 20 },
    { location: [0.004, 0.002], residents: 30, jobs: 10 },
    { location: [-0.004, -0.002], residents: 20, jobs: 8 },
  ]), {
    residentWeightedNearestNeighborKm: { p50: 0.8 },
    workerWeightedNearestNeighborKm: { p50: 0.8 },
  });

  const balanced = computePolycentrismMetrics(buildDemandData([
    { location: [0, 0], residents: 30, jobs: 10 },
    { location: [0.004, 0.002], residents: 25, jobs: 12 },
    { location: [0.08, 0.08], residents: 32, jobs: 11 },
    { location: [0.084, 0.082], residents: 26, jobs: 10 },
  ]), {
    residentWeightedNearestNeighborKm: { p50: 0.8 },
    workerWeightedNearestNeighborKm: { p50: 0.8 },
  });

  const nakaumiStyle = computePolycentrismMetrics(buildDemandData([
    { location: [0, 0], residents: 26, jobs: 10 },
    { location: [0.005, 0.003], residents: 20, jobs: 8 },
    { location: [0.06, 0.02], residents: 24, jobs: 9 },
    { location: [0.064, 0.023], residents: 19, jobs: 7 },
    { location: [0.03, 0.07], residents: 18, jobs: 6 },
    { location: [0.034, 0.074], residents: 15, jobs: 5 },
  ]), {
    residentWeightedNearestNeighborKm: { p50: 0.8 },
    workerWeightedNearestNeighborKm: { p50: 0.8 },
  });

  assert.ok(nakaumiStyle.residents.detectedCenterCount >= 3);
  assert.ok(nakaumiStyle.residents.score > monocentric.residents.score + 0.3);
  assert.ok(nakaumiStyle.residents.score < balanced.residents.score);
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

  const polycentrism = computePolycentrismMetrics(noisyDemandData, {
    residentWeightedNearestNeighborKm: { p50: 4 },
    workerWeightedNearestNeighborKm: { p50: 4 },
  });

  assert.ok(polycentrism.residents.detectedCenterCount <= 2);
  assert.ok(polycentrism.residents.reliabilityScore < 0.7);
  assert.ok(["low", "medium"].includes(polycentrism.residents.supportLevel));
});

test("computePolycentrismMetrics uses detail metrics to widen adaptive bandwidth on sparse layouts", () => {
  const sparseDemandData = buildDemandData([
    { location: [0, 0], residents: 20, jobs: 5 },
    { location: [0.12, 0.12], residents: 18, jobs: 4 },
    { location: [0.24, 0.24], residents: 16, jobs: 3 },
  ]);

  const defaultPolycentrism = computePolycentrismMetrics(sparseDemandData);
  const widenedPolycentrism = computePolycentrismMetrics(sparseDemandData, {
    residentWeightedNearestNeighborKm: { p50: 6 },
    workerWeightedNearestNeighborKm: { p50: 6 },
  });

  assert.ok(widenedPolycentrism.residents.bandwidthKm > defaultPolycentrism.residents.bandwidthKm);
});
