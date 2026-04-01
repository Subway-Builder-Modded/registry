import test from "node:test";
import assert from "node:assert/strict";
import { computeGridDetailMetrics } from "../lib/map-detail-metrics.js";

test("computeGridDetailMetrics rewards fine spacing and low aggregation", () => {
  const metrics = computeGridDetailMetrics({
    residentMedianWeightedNearestNeighborKm: 0.12,
    workerMedianWeightedNearestNeighborKm: 0.14,
    populatedCellCount: 400,
    pointCount: 2_000,
    residentsTotal: 120_000,
    jobsTotal: 100_000,
  });

  assert.ok(metrics.localityScore > 0.95);
  assert.ok(metrics.deaggregationScore > 0.95);
  assert.ok(metrics.score > 0.95);
});

test("computeGridDetailMetrics penalizes fine spacing when demand is highly aggregated", () => {
  const fineDetailed = computeGridDetailMetrics({
    residentMedianWeightedNearestNeighborKm: 0.12,
    workerMedianWeightedNearestNeighborKm: 0.14,
    populatedCellCount: 400,
    pointCount: 2_000,
    residentsTotal: 120_000,
    jobsTotal: 100_000,
  });
  const aggregated = computeGridDetailMetrics({
    residentMedianWeightedNearestNeighborKm: 0.12,
    workerMedianWeightedNearestNeighborKm: 0.14,
    populatedCellCount: 400,
    pointCount: 50,
    residentsTotal: 120_000,
    jobsTotal: 100_000,
  });

  assert.ok(aggregated.localityScore > 0.95);
  assert.ok(aggregated.deaggregationScore < 0.3);
  assert.ok(aggregated.score < fineDetailed.score);
});

test("computeGridDetailMetrics does not collapse broad but deaggregated maps to zero", () => {
  const broadButReasonable = computeGridDetailMetrics({
    residentMedianWeightedNearestNeighborKm: 0.32,
    workerMedianWeightedNearestNeighborKm: 0.38,
    populatedCellCount: 400,
    pointCount: 2_000,
    residentsTotal: 120_000,
    jobsTotal: 100_000,
  });
  const broadAndAggregated = computeGridDetailMetrics({
    residentMedianWeightedNearestNeighborKm: 0.32,
    workerMedianWeightedNearestNeighborKm: 0.38,
    populatedCellCount: 400,
    pointCount: 100,
    residentsTotal: 120_000,
    jobsTotal: 100_000,
  });

  assert.ok(broadButReasonable.score > 0.2);
  assert.ok(broadButReasonable.score < 0.8);
  assert.ok(broadAndAggregated.deaggregationScore < broadButReasonable.deaggregationScore);
});

test("computeGridDetailMetrics is zero-safe for missing or malformed inputs", () => {
  assert.deepEqual(
    computeGridDetailMetrics({
      residentMedianWeightedNearestNeighborKm: 0,
      workerMedianWeightedNearestNeighborKm: 0,
      populatedCellCount: 0,
      pointCount: 0,
      residentsTotal: 0,
      jobsTotal: 0,
    }),
    {
      radiusKm: 0,
      expectedPointSpacingKm: 0,
      normalizedRadius: 0,
      activityPerPoint: 0,
      localityScore: 0,
      deaggregationScore: 0,
      score: 0,
    },
  );
});
