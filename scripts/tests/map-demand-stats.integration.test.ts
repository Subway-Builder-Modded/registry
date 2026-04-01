import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateMapDemandStats } from "../lib/map-demand-stats.js";
import { createDownloadAttributionDelta } from "../lib/download-attribution.js";
import { DEFAULT_INITIAL_VIEW_STATE, makeDemandZip, makeFetchRouter, writeJson } from "./map-demand-stats/helpers.js";

function writeDemandStatsCacheV2(
  repoRoot: string,
  listings: Record<string, unknown>,
): void {
  writeJson(join(repoRoot, "maps", "demand-stats-cache.json"), {
    schema_version: 2,
    listings,
  });
}


test("generateMapDemandStats updates manifests for github/custom install targets", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-integration-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "github-map"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "custom-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["github-map", "custom-map"],
  });

  writeJson(join(repoRoot, "maps", "github-map", "manifest.json"), {
    schema_version: 1,
    id: "github-map",
    name: "GitHub Map",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://github.com/owner/repo",
    update: { type: "github", repo: "owner/repo" },
    city_code: "ABC",
    country: "US",
    population: 1,
    residents_total: 1,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  writeJson(join(repoRoot, "maps", "custom-map", "manifest.json"), {
    schema_version: 1,
    id: "custom-map",
    name: "Custom Map",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/update.json" },
    city_code: "DEF",
    country: "US",
    population: 2,
    residents_total: 2,
    points_count: 1,
    population_count: 2,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const githubZip = await makeDemandZip([11, 22, 33]);
  const customZip = await makeDemandZip([5, 6]);
  const attributionDelta = createDownloadAttributionDelta("workflow:test", "run-map-demand");

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://api.github.com/graphql",
      handle: () => new Response(JSON.stringify({
        data: {
          repository: {
            releases: {
              nodes: [
                {
                  tagName: "v1.0.0",
                  releaseAssets: {
                    nodes: [
                      {
                        name: "map.zip",
                        downloadCount: 10,
                        downloadUrl: "https://downloads.example.com/github-map.zip",
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
          rateLimit: {
            remaining: 4999,
            cost: 1,
            resetAt: "2026-03-11T00:00:00Z",
          },
        },
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/github-map.zip",
      handle: () => new Response(new Uint8Array(githubZip)),
    },
    {
      match: (url) => url === "https://example.com/update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            download: "https://downloads.example.com/custom-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/custom-map.zip",
      handle: () => new Response(new Uint8Array(customZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
      token: "test-token",
      attributionDelta,
    });

    assert.equal(result.processedMaps, 2);
    assert.equal(result.updatedMaps, 2);
    assert.equal(result.gridFilesWritten, 2);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.skippedUnchanged, 0);
    assert.equal(result.extractionFailures, 0);
    assert.equal(result.residentsDeltaTotal, 74);
    assert.equal(result.attributionFetchesAdded, 1);
    assert.deepEqual(result.warnings, []);
    assert.equal(attributionDelta.assets["owner/repo@v1.0.0/map.zip"], 1);
    assert.equal(Object.keys(attributionDelta.assets).length, 1);

    const githubManifest = JSON.parse(readFileSync(join(repoRoot, "maps", "github-map", "manifest.json"), "utf-8"));
    assert.equal(githubManifest.population, 66);
    assert.equal(githubManifest.residents_total, 66);
    assert.equal(githubManifest.points_count, 3);
    assert.equal(githubManifest.population_count, 3);
    assert.ok(githubManifest.grid_statistics);
    assert.ok(githubManifest.grid_statistics.commuteDistanceKm);
    assert.ok(githubManifest.grid_statistics.polycentrism);

    const customManifest = JSON.parse(readFileSync(join(repoRoot, "maps", "custom-map", "manifest.json"), "utf-8"));
    assert.equal(customManifest.population, 11);
    assert.equal(customManifest.residents_total, 11);
    assert.equal(customManifest.points_count, 2);
    assert.equal(customManifest.population_count, 2);
    assert.ok(customManifest.grid_statistics);
    assert.ok(customManifest.grid_statistics.commuteDistanceKm);
    assert.ok(customManifest.grid_statistics.polycentrism);

    assert.equal(existsSync(join(repoRoot, "maps", "github-map", "grid.geojson")), true);
    assert.equal(existsSync(join(repoRoot, "maps", "custom-map", "grid.geojson")), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats chooses latest semver custom version (not versions[0])", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-custom-latest-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "custom-latest-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["custom-latest-map"],
  });

  writeJson(join(repoRoot, "maps", "custom-latest-map", "manifest.json"), {
    schema_version: 1,
    id: "custom-latest-map",
    name: "Custom Latest",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/custom-latest-update.json" },
    city_code: "CLAT",
    country: "US",
    population: 0,
    residents_total: 0,
    points_count: 0,
    population_count: 0,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const latestZip = await makeDemandZip([10, 20, 30]);
  let oldZipFetchCount = 0;

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/custom-latest-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "0.1.0",
            download: "https://downloads.example.com/custom-latest-old.zip",
          },
          {
            version: "1.2.0",
            download: "https://downloads.example.com/custom-latest-new.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/custom-latest-old.zip",
      handle: () => {
        oldZipFetchCount += 1;
        return new Response("not-a-zip");
      },
    },
    {
      match: (url) => url === "https://downloads.example.com/custom-latest-new.zip",
      handle: () => new Response(new Uint8Array(latestZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.extractionFailures, 0);
    assert.equal(oldZipFetchCount, 0);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "custom-latest-map", "manifest.json"), "utf-8"));
    assert.equal(manifest.population, 60);
    assert.equal(manifest.residents_total, 60);
    assert.equal(manifest.points_count, 3);
    assert.equal(manifest.population_count, 3);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats prefers the github asset named by manifest source for shared release repos", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-github-asset-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "bucharest-medium"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["bucharest-medium"],
  });

  writeJson(join(repoRoot, "maps", "bucharest-medium", "manifest.json"), {
    schema_version: 1,
    id: "bucharest-medium",
    name: "Bucharest",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://github.com/owner/romania/releases/latest/download/BUC.zip",
    update: { type: "github", repo: "owner/romania" },
    city_code: "BUC",
    country: "RO",
    population: 0,
    residents_total: 0,
    points_count: 0,
    population_count: 0,
    data_source: "Kontur",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const iasiZip = await makeDemandZip([328_946]);
  const bucharestZip = await makeDemandZip([2_300_000]);

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://api.github.com/graphql",
      handle: () => new Response(JSON.stringify({
        data: {
          repository: {
            releases: {
              nodes: [
                {
                  tagName: "v1.1.1",
                  releaseAssets: {
                    nodes: [
                      {
                        name: "IAS.zip",
                        downloadCount: 10,
                        downloadUrl: "https://downloads.example.com/IAS.zip",
                      },
                      {
                        name: "BUC.zip",
                        downloadCount: 20,
                        downloadUrl: "https://downloads.example.com/BUC.zip",
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
          rateLimit: {
            remaining: 4999,
            cost: 1,
            resetAt: "2026-03-11T00:00:00Z",
          },
        },
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/IAS.zip",
      handle: () => new Response(new Uint8Array(iasiZip)),
    },
    {
      match: (url) => url === "https://downloads.example.com/BUC.zip",
      handle: () => new Response(new Uint8Array(bucharestZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.extractionFailures, 0);
    assert.deepEqual(result.warnings, []);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "bucharest-medium", "manifest.json"), "utf-8"));
    assert.equal(manifest.population, 2_300_000);
    assert.equal(manifest.residents_total, 2_300_000);
    assert.equal(manifest.points_count, 1);
    assert.equal(manifest.population_count, 1);

    const cache = JSON.parse(readFileSync(join(repoRoot, "maps", "demand-stats-cache.json"), "utf-8"));
    assert.equal(cache.schema_version, 2);
    assert.equal(cache.listings["bucharest-medium"].source_fingerprint, "github:v1.1.1|BUC.zip");
    assert.equal(cache.listings["bucharest-medium"].grid.schema_version, 1);
    assert.equal(existsSync(join(repoRoot, "maps", "bucharest-medium", "grid.geojson")), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats warns when fetched custom payload is not a ZIP", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-nonzip-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "nonzip-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["nonzip-map"],
  });

  writeJson(join(repoRoot, "maps", "nonzip-map", "manifest.json"), {
    schema_version: 1,
    id: "nonzip-map",
    name: "Nonzip",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/nonzip-update.json" },
    city_code: "NZIP",
    country: "US",
    population: 9,
    residents_total: 9,
    points_count: 1,
    population_count: 9,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/nonzip-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            download: "https://downloads.example.com/nonzip-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/nonzip-map.zip",
      handle: () => new Response("not-a-zip", {
        headers: { "content-type": "text/plain" },
      }),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 0);
    assert.equal(result.gridFilesWritten, 0);
    assert.equal(result.skippedMaps, 1);
    assert.equal(result.extractionFailures, 1);
    assert.ok(
      result.warnings.some((warning) => warning.includes("nonzip-map") && warning.includes("not a ZIP")),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats skips failed maps and keeps existing manifests", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-skip-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "broken-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["broken-map"],
  });
  writeJson(join(repoRoot, "maps", "broken-map", "manifest.json"), {
    schema_version: 1,
    id: "broken-map",
    name: "Broken",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/broken-update.json" },
    city_code: "BROK",
    country: "US",
    population: 12,
    residents_total: 12,
    points_count: 3,
    population_count: 12,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/broken-update.json",
      handle: () => new Response("{}", { status: 200 }),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 0);
    assert.equal(result.gridFilesWritten, 0);
    assert.equal(result.skippedMaps, 1);
    assert.equal(result.skippedUnchanged, 0);
    assert.equal(result.extractionFailures, 1);
    assert.ok(
      result.warnings.some((warning) => warning.includes("broken-map") && warning.includes("versions array")),
    );

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "broken-map", "manifest.json"), "utf-8"));
    assert.equal(manifest.population, 12);
    assert.equal(manifest.residents_total, 12);
    assert.equal(manifest.points_count, 3);
    assert.equal(manifest.population_count, 12);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats skips unchanged sha fingerprint regardless of cache age", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-cache-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "cached-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["cached-map"],
  });
  writeJson(join(repoRoot, "maps", "cached-map", "manifest.json"), {
    schema_version: 1,
    id: "cached-map",
    name: "Cached",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/cached-update.json" },
    city_code: "CACH",
    country: "US",
    population: 12,
    residents_total: 12,
    points_count: 3,
    population_count: 12,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeDemandStatsCacheV2(repoRoot, {
    "cached-map": {
      source_fingerprint: "sha256:abc123",
      last_checked_at: new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString(),
      stats: {
        residents_total: 12,
        points_count: 3,
        population_count: 12,
        initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
      },
      grid: {
        schema_version: 1,
      },
    },
  });
  writeJson(join(repoRoot, "maps", "cached-map", "grid.geojson"), {
    type: "FeatureCollection",
    features: [],
    properties: {},
  });

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/cached-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "abc123",
            download: "https://downloads.example.com/should-not-be-fetched.zip",
          },
        ],
      })),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 0);
    assert.equal(result.gridFilesWritten, 0);
    assert.equal(result.skippedMaps, 1);
    assert.equal(result.skippedUnchanged, 1);
    assert.equal(result.extractionFailures, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats syncs grid_statistics from existing grid.geojson on unchanged cache hits", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-grid-statistics-sync-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "cached-grid-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["cached-grid-map"],
  });
  writeJson(join(repoRoot, "maps", "cached-grid-map", "manifest.json"), {
    schema_version: 1,
    id: "cached-grid-map",
    name: "Cached Grid Map",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/cached-grid-update.json" },
    city_code: "CGRD",
    country: "US",
    population: 12,
    residents_total: 12,
    points_count: 3,
    population_count: 12,
    initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeDemandStatsCacheV2(repoRoot, {
    "cached-grid-map": {
      source_fingerprint: "sha256:gridstats",
      last_checked_at: new Date().toISOString(),
      stats: {
        residents_total: 12,
        points_count: 3,
        population_count: 12,
        initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
      },
      grid: {
        schema_version: 1,
      },
    },
  });
  writeJson(join(repoRoot, "maps", "cached-grid-map", "grid.geojson"), {
    type: "FeatureCollection",
    features: [],
    properties: {
      commuteDistanceKm: {
        p10: 1,
        p25: 2,
        p50: 3,
        p75: 4,
        p90: 4,
        mean: 2.5,
      },
      polycentrism: {
        activity: {
          score: 0.4,
          continuousScore: 0.3,
          detectedCenterCount: 2,
          effectiveCenterCount: 1.7,
          largestCenterShare: 0.65,
          bandwidthKm: 2,
          reliabilityScore: 0.6,
          supportLevel: "medium",
          usedFallback: false,
          topCenters: [],
          debug: {
            rawPeakCount: 3,
            mergedPeakCount: 2,
            filteredPeakCount: 2,
            prominenceThreshold: 0.22,
            minPointsPerCenter: 2,
            rejectedCenters: [],
          },
        },
      },
    },
  });

  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/cached-grid-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "gridstats",
            download: "https://downloads.example.com/should-not-be-fetched.zip",
          },
        ],
      })),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 0);
    assert.equal(result.skippedMaps, 1);
    assert.equal(result.skippedUnchanged, 1);
    assert.equal(result.extractionFailures, 0);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "cached-grid-map", "manifest.json"), "utf-8"));
    assert.deepEqual(manifest.grid_statistics, {
      commuteDistanceKm: {
        p10: 1,
        p25: 2,
        p50: 3,
        p75: 4,
        p90: 4,
        mean: 2.5,
      },
      polycentrism: {
        activity: {
          score: 0.4,
          continuousScore: 0.3,
          detectedCenterCount: 2,
          effectiveCenterCount: 1.7,
          largestCenterShare: 0.65,
          bandwidthKm: 2,
          reliabilityScore: 0.6,
          supportLevel: "medium",
          usedFallback: false,
          topCenters: [],
          debug: {
            rawPeakCount: 3,
            mergedPeakCount: 2,
            filteredPeakCount: 2,
            prominenceThreshold: 0.22,
            minPointsPerCenter: 2,
            rejectedCenters: [],
          },
        },
      },
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats recomputes when unchanged fingerprint cache is missing grid metadata", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-grid-refresh-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "grid-refresh-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["grid-refresh-map"],
  });
  writeJson(join(repoRoot, "maps", "grid-refresh-map", "manifest.json"), {
    schema_version: 1,
    id: "grid-refresh-map",
    name: "Grid Refresh",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/grid-refresh-update.json" },
    city_code: "GRID",
    country: "US",
    population: 100,
    residents_total: 100,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeDemandStatsCacheV2(repoRoot, {
    "grid-refresh-map": {
      source_fingerprint: "sha256:abc123",
      last_checked_at: new Date().toISOString(),
      stats: {
        residents_total: 24,
        points_count: 3,
        population_count: 3,
        initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
      },
    },
  });

  const refreshZip = await makeDemandZip([7, 8, 9]);
  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/grid-refresh-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "abc123",
            download: "https://downloads.example.com/grid-refresh-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/grid-refresh-map.zip",
      handle: () => new Response(new Uint8Array(refreshZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.skippedUnchanged, 0);
    assert.equal(result.extractionFailures, 0);
    assert.equal(existsSync(join(repoRoot, "maps", "grid-refresh-map", "grid.geojson")), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats treats legacy cache schema as invalid and rewrites v2 cache", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-legacy-cache-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "legacy-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["legacy-map"],
  });
  writeJson(join(repoRoot, "maps", "legacy-map", "manifest.json"), {
    schema_version: 1,
    id: "legacy-map",
    name: "Legacy",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/legacy-update.json" },
    city_code: "LEGC",
    country: "US",
    population: 100,
    residents_total: 100,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeJson(join(repoRoot, "maps", "demand-stats-cache.json"), {
    "legacy-map": {
      source_fingerprint: "sha256:abc123",
      last_checked_at: new Date().toISOString(),
    },
  });

  const legacyZip = await makeDemandZip([7, 8, 9]);
  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/legacy-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "abc123",
            download: "https://downloads.example.com/legacy-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/legacy-map.zip",
      handle: () => new Response(new Uint8Array(legacyZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.skippedUnchanged, 0);
    assert.equal(result.extractionFailures, 0);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "legacy-map", "manifest.json"), "utf-8"));
    assert.equal(manifest.population, 24);
    assert.equal(manifest.residents_total, 24);
    assert.equal(manifest.points_count, 3);
    assert.equal(manifest.population_count, 3);

    const cache = JSON.parse(readFileSync(join(repoRoot, "maps", "demand-stats-cache.json"), "utf-8"));
    assert.equal(cache.schema_version, 2);
    assert.equal(cache.listings["legacy-map"].grid.schema_version, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats force mode bypasses unchanged sha cache checks", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-force-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "force-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["force-map"],
  });
  writeJson(join(repoRoot, "maps", "force-map", "manifest.json"), {
    schema_version: 1,
    id: "force-map",
    name: "Force",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/force-update.json" },
    city_code: "FORC",
    country: "US",
    population: 5,
    residents_total: 5,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeDemandStatsCacheV2(repoRoot, {
    "force-map": {
      source_fingerprint: "sha256:abc123",
      last_checked_at: new Date().toISOString(),
      stats: {
        residents_total: 5,
        points_count: 1,
        population_count: 1,
        initial_view_state: DEFAULT_INITIAL_VIEW_STATE,
      },
      grid: {
        schema_version: 1,
      },
    },
  });
  writeJson(join(repoRoot, "maps", "force-map", "grid.geojson"), {
    type: "FeatureCollection",
    features: [],
    properties: {},
  });

  const forceZip = await makeDemandZip([7, 8, 9]);
  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/force-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "abc123",
            download: "https://downloads.example.com/force-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/force-map.zip",
      handle: () => new Response(new Uint8Array(forceZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
      force: true,
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.skippedUnchanged, 0);
    assert.equal(result.extractionFailures, 0);

    const manifest = JSON.parse(readFileSync(join(repoRoot, "maps", "force-map", "manifest.json"), "utf-8"));
    assert.equal(manifest.population, 24);
    assert.equal(manifest.residents_total, 24);
    assert.equal(manifest.points_count, 3);
    assert.equal(manifest.population_count, 3);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateMapDemandStats mapId option processes only the target map", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-demand-id-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "target-map"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "other-map"), { recursive: true });

  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["target-map", "other-map"],
  });
  writeJson(join(repoRoot, "maps", "target-map", "manifest.json"), {
    schema_version: 1,
    id: "target-map",
    name: "Target",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/target-update.json" },
    city_code: "TARG",
    country: "US",
    population: 5,
    residents_total: 5,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });
  writeJson(join(repoRoot, "maps", "other-map", "manifest.json"), {
    schema_version: 1,
    id: "other-map",
    name: "Other",
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["europe"],
    gallery: ["gallery/a.png"],
    source: "https://example.com/source",
    update: { type: "custom", url: "https://example.com/other-update.json" },
    city_code: "OTHR",
    country: "US",
    population: 9,
    residents_total: 9,
    points_count: 1,
    population_count: 1,
    data_source: "LODES",
    source_quality: "medium-quality",
    level_of_detail: "medium-detail",
    location: "europe",
    special_demand: [],
  });

  const targetZip = await makeDemandZip([4, 5, 6]);
  const fetchMock = makeFetchRouter([
    {
      match: (url) => url === "https://example.com/target-update.json",
      handle: () => new Response(JSON.stringify({
        schema_version: 1,
        versions: [
          {
            version: "1.0.0",
            sha256: "target-sha",
            download: "https://downloads.example.com/target-map.zip",
          },
        ],
      })),
    },
    {
      match: (url) => url === "https://downloads.example.com/target-map.zip",
      handle: () => new Response(new Uint8Array(targetZip)),
    },
  ]);

  try {
    const result = await generateMapDemandStats({
      repoRoot,
      fetchImpl: fetchMock,
      mapId: "target-map",
    });

    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.gridFilesWritten, 1);
    assert.equal(result.skippedMaps, 0);
    assert.equal(result.extractionFailures, 0);

    const targetManifest = JSON.parse(readFileSync(join(repoRoot, "maps", "target-map", "manifest.json"), "utf-8"));
    assert.equal(targetManifest.population, 15);
    assert.equal(targetManifest.residents_total, 15);

    const otherManifest = JSON.parse(readFileSync(join(repoRoot, "maps", "other-map", "manifest.json"), "utf-8"));
    assert.equal(otherManifest.population, 9);
    assert.equal(otherManifest.residents_total, 9);
    assert.equal(otherManifest.points_count, 1);
    assert.equal(otherManifest.population_count, 1);
    assert.equal(existsSync(join(repoRoot, "maps", "target-map", "grid.geojson")), true);
    assert.equal(existsSync(join(repoRoot, "maps", "other-map", "grid.geojson")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
