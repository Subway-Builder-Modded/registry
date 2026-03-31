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

test("generateGrid aggregates commute metrics into populated and empty cells", async () => {
  const grid = await generateGrid({
    points: [
      { id: "min-boundary", location: [0, 0], jobs: 0, residents: 0 },
      { id: "pt1", location: [0.01, 0.01], jobs: 3, residents: 10 },
      { id: "pt2", location: [0.0105, 0.0105], jobs: 5, residents: 20 },
      { id: "pt3", location: [0.03, 0.03], jobs: 7, residents: 30 },
      { id: "max-boundary", location: [0.04, 0.04], jobs: 0, residents: 0 },
    ],
    pops: [
      { residenceId: "pt1", jobId: "pt2", drivingDistance: 5 },
      { residenceId: "pt2", jobId: "pt1", drivingDistance: 10 },
      { residenceId: "pt1", jobId: "pt1", drivingDistance: 15 },
      { residenceId: "pt2", jobId: "pt2", drivingDistance: 20 },
    ],
  }, "sample-map");

  const gridSummary = grid as typeof grid & {
    properties?: { meanCommuteDistance?: number; medianCommuteDistance?: number };
  };

  assert.equal(gridSummary.properties?.meanCommuteDistance, 12.5);
  assert.equal(gridSummary.properties?.medianCommuteDistance, 15);

  const populatedCell = grid.features.find((feature: any) => feature.properties?.pointCount === 2);
  assert.ok(populatedCell);
  assert.equal(populatedCell.properties?.jobs, 8);
  assert.equal(populatedCell.properties?.pop, 30);
  assert.equal(populatedCell.properties?.homeWorkCommuteMedian, 15);
  assert.equal(populatedCell.properties?.workHomeCommuteMedian, 15);

  const emptyCommuteCell = grid.features.find((feature: any) => (
    feature.properties?.pointCount === 1
    && feature.properties?.jobs === 7
    && feature.properties?.pop === 30
  ));
  assert.ok(emptyCommuteCell);
  assert.equal(emptyCommuteCell.properties?.homeWorkCommuteMedian, -1);
  assert.equal(emptyCommuteCell.properties?.workHomeCommuteMedian, -1);
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
