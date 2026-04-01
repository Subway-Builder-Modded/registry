import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  collectLocalGridStatistics,
  writeLocalGridStatisticsReport,
} from "../lib/local-grid-statistics.js";
import { buildDemandPayload, DEFAULT_INITIAL_VIEW_STATE } from "./map-demand-stats/helpers.js";

test("collectLocalGridStatistics reads city folders and synthesizes missing config when needed", async () => {
  const root = mkdtempSync(join(tmpdir(), "railyard-local-grid-stats-"));
  const inputDir = join(root, "cities", "data");
  mkdirSync(inputDir, { recursive: true });

  const cityA = join(inputDir, "AAA");
  mkdirSync(cityA, { recursive: true });
  writeFileSync(
    join(cityA, "demand_data.json.gz"),
    gzipSync(Buffer.from(JSON.stringify(buildDemandPayload([10, 20], [10, 20])), "utf-8")),
  );
  writeFileSync(
    join(cityA, "config.json"),
    JSON.stringify({ code: "AAA", initialViewState: DEFAULT_INITIAL_VIEW_STATE }),
  );

  const cityB = join(inputDir, "BBB");
  mkdirSync(cityB, { recursive: true });
  writeFileSync(
    join(cityB, "demand_data.json"),
    JSON.stringify(buildDemandPayload([5, 6, 7], [5, 6, 7])),
  );

  const cityC = join(inputDir, "CCC");
  mkdirSync(cityC, { recursive: true });

  try {
    const report = await collectLocalGridStatistics(inputDir);
    assert.equal(report.processedCount, 2);
    assert.equal(report.failedCount, 1);

    const aaa = report.entries.find((entry) => entry.cityCode === "AAA");
    const bbb = report.entries.find((entry) => entry.cityCode === "BBB");
    const ccc = report.failures.find((entry) => entry.cityCode === "CCC");

    assert.ok(aaa);
    assert.equal(aaa.usedSyntheticConfig, false);
    assert.equal(typeof aaa.grid_statistics.commuteDistanceKm, "object");

    assert.ok(bbb);
    assert.equal(bbb.usedSyntheticConfig, true);
    assert.equal(typeof bbb.grid_statistics.polycentrism, "object");

    assert.ok(ccc);
    assert.match(ccc.error, /demand_data\.json/);

    const outputPath = join(root, "analytics", "local_grid_statistics.json");
    writeLocalGridStatisticsReport(outputPath, report);
    const persisted = JSON.parse(readFileSync(outputPath, "utf-8")) as { processedCount: number };
    assert.equal(persisted.processedCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
