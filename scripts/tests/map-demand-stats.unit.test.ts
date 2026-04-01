import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import { generateGrid } from "../lib/map-analytics-grid.js";
import { extractDemandStatsFromZipBuffer } from "../lib/map-demand-stats.js";
import { DEFAULT_INITIAL_VIEW_STATE, buildDemandPayload, makeZipBuffer } from "./map-demand-stats/helpers.js";

function assertClose(actual: number, expected: number, tolerance = 0.05): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("generateGrid emits percentile metric bundles and aggregated cell counts", async () => {
  const grid = await generateGrid({
    points: [
      { id: "min-boundary", location: [-0.03, -0.03], jobs: 0, residents: 0 },
      { id: "pt1", location: [0, 0], jobs: 1, residents: 10 },
      { id: "pt2", location: [0.005, 0.005], jobs: 3, residents: 20 },
      { id: "pt3", location: [0.03, 0.03], jobs: 5, residents: 30 },
      { id: "max-boundary", location: [0.06, 0.06], jobs: 0, residents: 0 },
    ],
    pops: [
      { residenceId: "pt1", jobId: "pt2", drivingDistance: 5 },
      { residenceId: "pt2", jobId: "pt1", drivingDistance: 10 },
      { residenceId: "pt1", jobId: "pt1", drivingDistance: 15 },
      { residenceId: "pt2", jobId: "pt2", drivingDistance: 20 },
    ],
  }, "sample-map");

  const gridSummary = grid as typeof grid & {
    properties?: {
      residentWeightedNearestNeighborKm?: {
        p10?: number;
        p25?: number;
        p50?: number;
        p75?: number;
        mean?: number;
      };
      workerWeightedNearestNeighborKm?: {
        p10?: number;
        p25?: number;
        p50?: number;
        p75?: number;
        mean?: number;
      };
      commuteDistanceKm?: {
        p10?: number;
        p25?: number;
        p50?: number;
        p75?: number;
        mean?: number;
      };
      residentCellDensity?: {
        p10?: number;
        p25?: number;
        p50?: number;
        p75?: number;
        mean?: number;
      };
      workerCellDensity?: {
        p10?: number;
        p25?: number;
        p50?: number;
        p75?: number;
        mean?: number;
      };
      detail?: {
        radiusKm?: number;
        expectedPointSpacingKm?: number;
        normalizedRadius?: number;
        activityPerPoint?: number;
        localityScore?: number;
        deaggregationScore?: number;
        score?: number;
      };
      polycentrism?: {
        activity?: {
          detectedCenterCount?: number;
          score?: number;
          continuousScore?: number;
          topCenters?: Array<{ massShare?: number }>;
        };
      };
      meanCommuteDistance?: number;
      medianCommuteDistance?: number;
    };
  };

  assert.equal(gridSummary.properties?.meanCommuteDistance, undefined);
  assert.equal(gridSummary.properties?.medianCommuteDistance, undefined);
  assert.deepEqual(gridSummary.properties?.commuteDistanceKm, {
    p10: 5,
    p25: 5,
    p50: 10,
    p75: 15,
    p90: 20,
    mean: 12.5,
  });
  assert.deepEqual(gridSummary.properties?.residentCellDensity, {
    p10: 30,
    p25: 30,
    p50: 30,
    p75: 30,
    p90: 30,
    mean: 30,
  });
  assert.deepEqual(gridSummary.properties?.workerCellDensity, {
    p10: 4,
    p25: 4,
    p50: 4,
    p75: 5,
    p90: 5,
    mean: 4.5,
  });
  assertClose(gridSummary.properties?.residentWeightedNearestNeighborKm?.p10 ?? 0, 0.79);
  assertClose(gridSummary.properties?.residentWeightedNearestNeighborKm?.p25 ?? 0, 0.79);
  assertClose(gridSummary.properties?.residentWeightedNearestNeighborKm?.p50 ?? 0, 0.79);
  assertClose(gridSummary.properties?.residentWeightedNearestNeighborKm?.p75 ?? 0, 3.93);
  assertClose(gridSummary.properties?.residentWeightedNearestNeighborKm?.mean ?? 0, 2.36);
  assertClose(gridSummary.properties?.workerWeightedNearestNeighborKm?.p10 ?? 0, 0.79);
  assertClose(gridSummary.properties?.workerWeightedNearestNeighborKm?.p25 ?? 0, 0.79);
  assertClose(gridSummary.properties?.workerWeightedNearestNeighborKm?.p50 ?? 0, 3.93);
  assertClose(gridSummary.properties?.workerWeightedNearestNeighborKm?.p75 ?? 0, 3.93);
  assertClose(gridSummary.properties?.workerWeightedNearestNeighborKm?.mean ?? 0, 2.53);
  assert.ok((gridSummary.properties?.detail?.radiusKm ?? 0) > 0);
  assert.ok((gridSummary.properties?.detail?.expectedPointSpacingKm ?? 0) > 0);
  assert.ok((gridSummary.properties?.detail?.normalizedRadius ?? 0) > 0);
  assert.ok((gridSummary.properties?.detail?.activityPerPoint ?? 0) > 0);
  assert.ok((gridSummary.properties?.detail?.localityScore ?? 0) >= 0);
  assert.ok((gridSummary.properties?.detail?.localityScore ?? 0) <= 1);
  assert.ok((gridSummary.properties?.detail?.deaggregationScore ?? 0) >= 0);
  assert.ok((gridSummary.properties?.detail?.deaggregationScore ?? 0) <= 1);
  assert.ok((gridSummary.properties?.detail?.score ?? 0) >= 0);
  assert.ok((gridSummary.properties?.detail?.score ?? 0) <= 1);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.detectedCenterCount ?? 0) >= 1);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.score ?? 0) >= 0);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.score ?? 0) <= 1);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.continuousScore ?? 0) >= 0);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.continuousScore ?? 0) <= 1);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.topCenters?.length ?? 0) >= 1);
  assert.ok((gridSummary.properties?.polycentrism?.activity?.topCenters?.[0]?.massShare ?? 0) > 0);

  const populatedCell = grid.features.find((feature: any) => feature.properties?.pointCount === 2);
  assert.ok(populatedCell);
  assert.equal(populatedCell.properties?.jobs, 4);
  assert.equal(populatedCell.properties?.pop, 30);
  assert.equal(populatedCell.properties?.homeWorkCommuteMedian, undefined);
  assert.equal(populatedCell.properties?.workHomeCommuteMedian, undefined);

  const secondCell = grid.features.find((feature: any) => (
    feature.properties?.pointCount === 1
    && feature.properties?.jobs === 5
    && feature.properties?.pop === 30
  ));
  assert.ok(secondCell);
});

test("generateGrid returns zeroed metric bundles when commute and density samples are empty", async () => {
  const grid = await generateGrid({
    points: [
      { id: "solo", location: [0, 0], jobs: 0, residents: 0 },
    ],
    pops: [],
  }, "empty-metrics-map");

  const gridSummary = grid as typeof grid & {
    properties?: {
      residentWeightedNearestNeighborKm?: unknown;
      workerWeightedNearestNeighborKm?: unknown;
      commuteDistanceKm?: unknown;
      residentCellDensity?: unknown;
      workerCellDensity?: unknown;
      detail?: unknown;
    };
  };

  assert.deepEqual(gridSummary.properties?.residentWeightedNearestNeighborKm, {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    mean: 0,
  });
  assert.deepEqual(gridSummary.properties?.workerWeightedNearestNeighborKm, {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    mean: 0,
  });
  assert.deepEqual(gridSummary.properties?.commuteDistanceKm, {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    mean: 0,
  });
  assert.deepEqual(gridSummary.properties?.residentCellDensity, {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    mean: 0,
  });
  assert.deepEqual(gridSummary.properties?.workerCellDensity, {
    p10: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p90: 0,
    mean: 0,
  });
  assert.deepEqual(gridSummary.properties?.detail, {
    radiusKm: 0,
    expectedPointSpacingKm: 0,
    normalizedRadius: 0,
    activityPerPoint: 0,
    localityScore: 0,
    deaggregationScore: 0,
    score: 0,
  });
});

test("extractDemandStatsFromZipBuffer returns stats and grid without writing files directly", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-unit-"));
  mkdirSync(join(repoRoot, "maps", "sample-map"), { recursive: true });
  const payload = buildDemandPayload([10, 15, 5], [10, 15, 5]);
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));

  try {
    const extraction = await extractDemandStatsFromZipBuffer("sample-map", zipBuffer);

    assert.deepEqual(extraction.stats, {
      residents_total: 30,
      points_count: 3,
      population_count: 3,
      initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
    });
    assert.deepEqual((extraction.grid as typeof extraction.grid & {
      properties?: {
        commuteDistanceKm?: { p10?: number; p25?: number; p50?: number; p75?: number; p90?: number; mean?: number };
      };
    }).properties?.commuteDistanceKm, {
      p10: 10,
      p25: 10,
      p50: 20,
      p75: 30,
      p90: 30,
      mean: 20,
    });
    assert.ok(extraction.grid.features.length > 0);
    assert.equal(existsSync(join(repoRoot, "maps", "sample-map", "grid.geojson")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("extractDemandStatsFromZipBuffer parses demand_data.json.gz", async () => {
  const payload = buildDemandPayload([7, 8, 9], [7, 8, 9]);
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
  const zipBuffer = await makeZipBuffer("demand_data.json.gz", compressed);
  const extraction = await extractDemandStatsFromZipBuffer("sample-map", zipBuffer);

  assert.deepEqual(extraction.stats, {
    residents_total: 24,
    points_count: 3,
    population_count: 3,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
  });
});

test("extractDemandStatsFromZipBuffer warns and uses minimum when point/pop totals differ", async () => {
  const payload = buildDemandPayload([100, 50], [40, 30]);
  const warnings: string[] = [];
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));
  const extraction = await extractDemandStatsFromZipBuffer("sample-map", zipBuffer, { warnings });

  assert.deepEqual(extraction.stats, {
    residents_total: 70,
    points_count: 2,
    population_count: 2,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /resident totals differ/);
  assert.match(warnings[0], /using minimum=70/);
});

test("extractDemandStatsFromZipBuffer rejects mismatched residents totals when strict mode is enabled", async () => {
  const payload = buildDemandPayload([100, 50], [40, 30]);
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));

  await assert.rejects(
    extractDemandStatsFromZipBuffer("sample-map", zipBuffer, { requireResidentTotalsMatch: true }),
    /resident totals mismatch/,
  );
});

test("extractDemandStatsFromZipBuffer derives residents from popIds when residents is missing", async () => {
  const payload = {
    points: [
      { id: "p1", location: [0, 0], jobs: 1, popIds: ["a", "b"] },
      { id: "p2", location: [0.03, 0.03], jobs: 2, popIds: ["c"] },
    ],
    pops_map: [
      { id: "a", size: 3 },
      { id: "b", size: 4 },
      { id: "c", size: 5 },
    ],
    pops: [
      { residenceId: "p1", jobId: "p2", drivingDistance: 10 },
      { residenceId: "p2", jobId: "p1", drivingDistance: 20 },
    ],
  };
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));
  const extraction = await extractDemandStatsFromZipBuffer("sample-map", zipBuffer);

  assert.deepEqual(extraction.stats, {
    residents_total: 12,
    points_count: 2,
    population_count: 3,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
  });
});

test("extractDemandStatsFromZipBuffer does not mix residents fallback with explicit residents values", async () => {
  const payload = {
    points: [
      { id: "p1", location: [0, 0], jobs: 1, residents: 10, popIds: ["a"] },
      { id: "p2", location: [0.03, 0.03], jobs: 2, popIds: ["b"] },
    ],
    pops_map: [
      { id: "a", size: 10 },
      { id: "b", size: 50 },
    ],
    pops: [
      { residenceId: "p1", jobId: "p1", drivingDistance: 5 },
      { residenceId: "p2", jobId: "p2", drivingDistance: 15 },
    ],
  };
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));
  const extraction = await extractDemandStatsFromZipBuffer("sample-map", zipBuffer);

  assert.deepEqual(extraction.stats, {
    residents_total: 10,
    points_count: 2,
    population_count: 2,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
  });
});

test("extractDemandStatsFromZipBuffer rejects negative residents values", async () => {
  const payload = {
    points: [
      { id: "a", location: [0, 0], jobs: 1, residents: -3 },
      { id: "b", location: [0.03, 0.03], jobs: 2, residents: 7 },
    ],
    pops_map: [
      { id: "p1", size: 1 },
    ],
    pops: [
      { residenceId: "a", jobId: "b", drivingDistance: 10 },
    ],
  };
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));
  await assert.rejects(
    extractDemandStatsFromZipBuffer("sample-map", zipBuffer),
    /demand point 'a' has negative residents value/,
  );
});

test("extractDemandStatsFromZipBuffer rejects negative population size using population id", async () => {
  const payload = {
    points: [
      { id: "point-a", location: [0, 0], jobs: 1, residents: 10 },
      { id: "point-b", location: [0.03, 0.03], jobs: 2, residents: 5 },
    ],
    pops_map: [
      { id: "pop-1329", size: -10 },
    ],
    pops: [
      { residenceId: "point-a", jobId: "point-b", drivingDistance: 10 },
    ],
  };
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(payload));
  await assert.rejects(
    extractDemandStatsFromZipBuffer("sample-map", zipBuffer),
    /population entry 'pop-1329' has negative size value/,
  );
});

test("extractDemandStatsFromZipBuffer rejects malformed payloads", async () => {
  const badPayload = { points: "invalid", pops_map: {} };
  const zipBuffer = await makeZipBuffer("demand_data.json", JSON.stringify(badPayload));

  await assert.rejects(
    extractDemandStatsFromZipBuffer("sample-map", zipBuffer),
    /missing collection field 'points'/,
  );
});

test("extractDemandStatsFromZipBuffer rejects missing initialViewState in config.json", async () => {
  const zip = new JSZip();
  zip.file(
    "demand_data.json",
    JSON.stringify(buildDemandPayload([1], [1])),
  );
  zip.file("config.json", JSON.stringify({ code: "TST" }));
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  await assert.rejects(
    extractDemandStatsFromZipBuffer("sample-map", zipBuffer),
    /config\.json missing valid initialViewState/,
  );
});
