import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("runGenerateAnalyticsCli writes maps_statistics.csv from grid.geojson and removes legacy maps_by_population.csv", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-statistics-"));
  mkdirSync(join(repoRoot, "analytics"), { recursive: true });
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "sample-map"), { recursive: true });

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
      population: 600,
      population_count: 9,
      points_count: 12,
    });
    writeJson(join(repoRoot, "maps", "sample-map", "grid.geojson"), {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            jobs: 10,
            pop: 100,
            pointCount: 4,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
        {
          type: "Feature",
          properties: {
            jobs: 30,
            pop: 300,
            pointCount: 2,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
        {
          type: "Feature",
          properties: {
            jobs: 20,
            pop: 200,
            pointCount: 6,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
      ],
      properties: {
        commuteDistanceKm: {
          p10: 9,
          p25: 10,
          p50: 12,
          p75: 14,
          p90: 16,
          mean: 15,
        },
        polycentrism: {
          activity: {
            detectedCenterCount: 2,
            continuousScore: 0.678,
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
            "1.0.0": 1,
          },
        },
      },
      mods: {
        downloads: {},
      },
    });
    writeFileSync(
      join(repoRoot, "analytics", "maps_by_population.csv"),
      "legacy,stale,file\n",
      "utf-8",
    );

    runGenerateAnalyticsCli([], repoRoot);

    const mapsStatisticsCsv = readFileSync(join(repoRoot, "analytics", "maps_statistics.csv"), "utf-8");
    assert.equal(
      mapsStatisticsCsv,
      [
        "rank,id,name,author,author_alias,attribution_link,city_code,country,population,population_count,points_count,n_cells,mean_point_density,median_cell_resident_density,mean_cell_resident_density,pct_cells_with_residents,median_cell_worker_density,mean_cell_worker_density,pct_cells_with_workers,median_commute_distance,mean_commute_distance,detected_center_count,polycentrism_score",
        "1,sample-map,Sample Map,mapmaker,mapmaker,https://github.com/mapmaker,ABC,US,600,9,12,3,4,200,200,100,20,20,100,12,15,2,0.68",
        "",
      ].join("\n"),
    );
    assert.equal(existsSync(join(repoRoot, "analytics", "maps_by_population.csv")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runGenerateAnalyticsCli computes resident and worker densities from non-zero cells only", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-statistics-positive-only-"));
  mkdirSync(join(repoRoot, "analytics"), { recursive: true });
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "sample-map"), { recursive: true });

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
      population: 600,
      population_count: 9,
      points_count: 12,
    });
    writeJson(join(repoRoot, "maps", "sample-map", "grid.geojson"), {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            jobs: 0,
            pop: 100,
            pointCount: 4,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
        {
          type: "Feature",
          properties: {
            jobs: 30,
            pop: 0,
            pointCount: 2,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
        {
          type: "Feature",
          properties: {
            jobs: 20,
            pop: 200,
            pointCount: 6,
          },
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
      ],
      properties: {
        commuteDistanceKm: {
          p10: 8.111,
          p25: 10.222,
          p50: 12.994,
          p75: 14.555,
          p90: 16.777,
          mean: 15.126,
        },
        polycentrism: {
          activity: {
            detectedCenterCount: 3,
            continuousScore: 0.444,
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
            "1.0.0": 1,
          },
        },
      },
      mods: {
        downloads: {},
      },
    });

    runGenerateAnalyticsCli([], repoRoot);

    const mapsStatisticsCsv = readFileSync(join(repoRoot, "analytics", "maps_statistics.csv"), "utf-8");
    assert.equal(
      mapsStatisticsCsv,
      [
        "rank,id,name,author,author_alias,attribution_link,city_code,country,population,population_count,points_count,n_cells,mean_point_density,median_cell_resident_density,mean_cell_resident_density,pct_cells_with_residents,median_cell_worker_density,mean_cell_worker_density,pct_cells_with_workers,median_commute_distance,mean_commute_distance,detected_center_count,polycentrism_score",
        "1,sample-map,Sample Map,mapmaker,mapmaker,https://github.com/mapmaker,ABC,US,600,9,12,3,4,200,150,66.67,30,25,66.67,12.99,15.13,3,0.44",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
