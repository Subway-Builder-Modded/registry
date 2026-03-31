import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGenerateAnalyticsCli } from "../lib/analytics-core.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

test("runGenerateAnalyticsCli writes assets_by_day.csv grouped by listing type", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-analytics-core-"));
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "sample-map"), { recursive: true });
  mkdirSync(join(repoRoot, "mods", "sample-mod"), { recursive: true });

  try {
    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["sample-map"],
    });
    writeJson(join(repoRoot, "maps", "sample-map", "manifest.json"), {
      schema_version: 1,
      id: "sample-map",
      name: "Sample Map",
      author: "mapmaker",
      github_id: 1,
      source: "https://github.com/example/sample-map",
      city_code: "ABC",
      country: "US",
      population: 0,
      population_count: 0,
      points_count: 0,
    });
    writeJson(join(repoRoot, "mods", "sample-mod", "manifest.json"), {
      schema_version: 1,
      id: "sample-mod",
      name: "Sample Mod",
      author: "modder",
      github_id: 2,
      source: "https://github.com/example/sample-mod",
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 2,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T00:00:00.000Z",
      maps: {
        downloads: {
          "sample-map": {
            "1.0.0": 10,
          },
        },
      },
      mods: {
        downloads: {
          "sample-mod": {
            "1.0.0": 5,
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_31.json"), {
      schema_version: 2,
      snapshot_date: "2026_03_31",
      generated_at: "2026-03-31T00:00:00.000Z",
      maps: {
        downloads: {
          "sample-map": {
            "1.0.0": 13,
          },
        },
      },
      mods: {
        downloads: {
          "sample-mod": {
            "1.0.0": 7,
          },
        },
      },
    });

    runGenerateAnalyticsCli([], repoRoot);

    const assetsByDayCsv = readFileSync(join(repoRoot, "analytics", "assets_by_day.csv"), "utf-8");
    assert.equal(
      assetsByDayCsv,
      [
        "snapshot_date,total_downloads,maps,mods,cumulative_total,cumulative_maps,cumulative_mods",
        "2026_03_30,15,10,5,15,10,5",
        "2026_03_31,5,3,2,20,13,7",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
