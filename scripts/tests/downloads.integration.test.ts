import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { generateDownloadsData } from "../lib/downloads.js";
import {
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
} from "../lib/download-attribution.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function makeBaseModManifest(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    name: id,
    author: "test",
    github_id: 1,
    description: "desc",
    tags: [],
    gallery: [],
    source: "https://github.com/example/example",
  };
}

function makeBaseMapManifest(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    name: id,
    author: "test",
    github_id: 1,
    description: "desc",
    tags: ["north-america"],
    gallery: ["gallery/1.webp"],
    source: "https://github.com/example/example",
    city_code: "ABC",
    country: "US",
    population: 0,
    residents_total: 0,
    points_count: 0,
    population_count: 0,
    initial_view_state: {
      latitude: 0,
      longitude: 0,
      zoom: 10,
      bearing: 0,
    },
    data_source: "OSM",
    source_quality: "low-quality",
    level_of_detail: "low-detail",
    location: "north-america",
    special_demand: [],
    file_sizes: {},
  };
}

async function makeModZip(includeTopLevelManifest: boolean, version = "1.0.0"): Promise<Buffer> {
  const zip = new JSZip();
  if (includeTopLevelManifest) {
    zip.file("manifest.json", JSON.stringify({ schema_version: 1, version }));
  }
  zip.file("mod.dll", "binary");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeModZipWithSources(
  includeTopLevelManifest: boolean,
  sources: Record<string, string>,
  version = "1.0.0",
): Promise<Buffer> {
  const zip = new JSZip();
  if (includeTopLevelManifest) {
    zip.file("manifest.json", JSON.stringify({ schema_version: 1, version }));
  }
  zip.file("mod.dll", "binary");
  for (const [path, source] of Object.entries(sources)) {
    zip.file(path, source);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeMapZip(cityCode: string, version = "1.0.0"): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("config.json", JSON.stringify({ code: cityCode, version }));
  zip.file("demand_data.json", JSON.stringify({
    points: [
      { id: "pt1", location: [0, 0], jobs: 1, residents: 1 },
    ],
    pops_map: [
      { id: "pop1", size: 1 },
    ],
    pops: [
      { residenceId: "pt1", jobId: "pt1", drivingDistance: 1 },
    ],
  }));
  zip.file("buildings_index.json", "{}");
  zip.file("roads.geojson", "{}");
  zip.file("runways_taxiways.geojson", "{}");
  zip.file(`${cityCode}.pmtiles`, "stub");
  return zip.generateAsync({ type: "nodebuffer" });
}

// Like makeMapZip, but adds one phantom demand point (neither residents nor jobs)
// close to the populated point. This fails ONLY the grandfathered
// demand_phantom_points check: spacing passes (points ~1.5km apart) and resident
// totals still match (the phantom contributes 0 residents on both sides).
async function makeMapZipWithPhantomPoint(cityCode: string, version = "1.0.0"): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("config.json", JSON.stringify({ code: cityCode, version }));
  zip.file("demand_data.json", JSON.stringify({
    points: [
      { id: "pt1", location: [0, 0], jobs: 1, residents: 1 },
      { id: "pt-phantom", location: [0.01, 0.01], jobs: 0, residents: 0 },
    ],
    pops_map: [
      { id: "pop1", size: 1 },
    ],
    pops: [
      { residenceId: "pt1", jobId: "pt1", drivingDistance: 1 },
    ],
  }));
  zip.file("buildings_index.json", "{}");
  zip.file("roads.geojson", "{}");
  zip.file("runways_taxiways.geojson", "{}");
  zip.file(`${cityCode}.pmtiles`, "stub");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeMapZipWithPointLocations(
  cityCode: string,
  locations: Array<{ id: string; location: [number, number] }>,
  version = "1.0.0",
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("config.json", JSON.stringify({ code: cityCode, version }));
  zip.file("demand_data.json", JSON.stringify({
    points: locations.map((point) => ({
      id: point.id,
      location: point.location,
      jobs: 1,
      residents: 1,
    })),
    pops_map: locations.map((point, index) => ({
      id: `pop${index + 1}`,
      size: 1,
    })),
    pops: locations.map((point) => ({
      residenceId: point.id,
      jobId: point.id,
      drivingDistance: 1,
    })),
  }));
  zip.file("buildings_index.json", "{}");
  zip.file("roads.geojson", "{}");
  zip.file("runways_taxiways.geojson", "{}");
  zip.file(`${cityCode}.pmtiles`, "stub");
  return zip.generateAsync({ type: "nodebuffer" });
}

interface TempRegistryContext {
  repoRoot: string;
  writeIndex: (kind: "maps" | "mods", ids: string[]) => void;
  writeManifest: (kind: "maps" | "mods", id: string, manifest: Record<string, unknown>) => void;
}

async function withTempRegistry(
  run: (context: TempRegistryContext) => Promise<void>,
): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-downloads-test-"));
  mkdirSync(join(repoRoot, "mods"), { recursive: true });
  mkdirSync(join(repoRoot, "maps"), { recursive: true });

  const context: TempRegistryContext = {
    repoRoot,
    writeIndex: (kind, ids) => {
      writeJson(join(repoRoot, kind, "index.json"), {
        schema_version: 1,
        [kind]: ids,
      });
    },
    writeManifest: (kind, id, manifest) => {
      mkdirSync(join(repoRoot, kind, id), { recursive: true });
      writeJson(join(repoRoot, kind, id, "manifest.json"), manifest);
    },
  };
  writeJson(join(repoRoot, "security-rules.json"), {
    schema_version: 1,
    rules: [],
  });

  try {
    await run(context);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

type FetchRoute = {
  match: (url: string) => boolean;
  handle: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
};

function makeFetchRouter(routes: FetchRoute[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const route = routes.find((entry) => entry.match(url));
    if (!route) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return route.handle(input, init);
  }) as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

test("github releases are integrity-validated and filtered before download aggregation", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["github-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "github-mod", {
      ...makeBaseModManifest("github-mod"),
      update: { type: "github", repo: "owner/good" },
    });

    const validZip = await makeModZip(true, "2.0.0");
    const invalidZip = await makeModZip(false);
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/good-v2.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://downloads.example.com/good-v1.zip",
        handle: () => new Response(new Uint8Array(invalidZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { variables: { owner: string; name: string; cursor: string | null } };
          assert.equal(body.variables.owner, "owner");
          assert.equal(body.variables.name, "good");
          assert.equal(body.variables.cursor, null);
          return jsonResponse({
            data: {
              repository: {
                releases: {
                  nodes: [
                    {
                      tagName: "v2.0.0",
                      releaseAssets: {
                        nodes: [
                          { name: "good-v2.zip", downloadCount: 15, downloadUrl: "https://downloads.example.com/good-v2.zip" },
                          { name: "manifest.json", downloadCount: 30, downloadUrl: "https://downloads.example.com/manifest-v2.json" },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                    {
                      tagName: "v1.0.0",
                      releaseAssets: {
                        nodes: [
                          { name: "good-v1.zip", downloadCount: 4, downloadUrl: "https://downloads.example.com/good-v1.zip" },
                          { name: "manifest.json", downloadCount: 20, downloadUrl: "https://downloads.example.com/manifest-v1.json" },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                    {
                      tagName: "latest",
                      releaseAssets: {
                        nodes: [
                          { name: "good-latest.zip", downloadCount: 999, downloadUrl: "https://downloads.example.com/good-latest.zip" },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
              rateLimit: {
                remaining: 120,
                cost: 1,
                resetAt: "2026-03-14T00:00:00Z",
              },
            },
          });
        },
      },
    ]);

    const { downloads, integrity, stats, warnings } = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(downloads, {
      "github-mod": {
        "v2.0.0": 14,
      },
    });
    assert.equal(stats.registry_fetches_added, 2);
    assert.equal(stats.adjusted_delta_total, 2);
    assert.equal(stats.filtered_versions, 1);
    assert.equal(stats.complete_versions, 1);
    assert.equal(stats.incomplete_versions, 2);
    assert.equal(integrity.listings["github-mod"]?.has_complete_version, true);
    assert.equal(integrity.listings["github-mod"]?.versions["latest"]?.is_complete, false);
    assert.equal(typeof integrity.listings["github-mod"]?.versions["v2.0.0"]?.release_size, "number");
    assert.equal(typeof integrity.listings["github-mod"]?.versions["v1.0.0"]?.release_size, "number");
    assert.ok(
      warnings.some((warning) => warning.includes("v1.0.0") && warning.includes("excluded by integrity validation")),
    );
  });
});

test("custom mixed versions produce explicit invalid integrity entries and hard-filter downloads", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["custom-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "custom-mod", {
      ...makeBaseModManifest("custom-mod"),
      update: { type: "custom", url: "https://example.com/custom-update.json" },
    });

    const validZip = await makeModZip(true);
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/custom-update.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://github.com/Owner/Good/releases/download/v1.0.0/good.zip",
              sha256: "sha-a",
            },
            {
              version: "1.1.0",
              download: "https://example.com/non-github.zip",
              sha256: "sha-b",
            },
            {
              version: "1.2.0",
              download: "https://github.com/Owner/Good/releases/download/v1.0.0/missing.zip",
              sha256: "sha-c",
            },
            {
              version: "beta",
              download: "https://github.com/Owner/Good/releases/download/latest/good.zip",
              sha256: "sha-d",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/good.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { variables: { owner: string; name: string } };
          assert.equal(body.variables.owner, "owner");
          assert.equal(body.variables.name, "good");
          return jsonResponse({
            data: {
              repository: {
                releases: {
                  nodes: [
                    {
                      tagName: "v1.0.0",
                      releaseAssets: {
                        nodes: [
                          { name: "good.zip", downloadCount: 12, downloadUrl: "https://downloads.example.com/good.zip" },
                          { name: "manifest.json", downloadCount: 10, downloadUrl: "https://downloads.example.com/manifest.json" },
                        ],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          });
        },
      },
    ]);

    const { downloads, integrity, stats } = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(downloads, {
      "custom-mod": {
        "1.0.0": 11,
      },
    });
    assert.equal(stats.registry_fetches_added, 1);
    assert.equal(stats.adjusted_delta_total, 1);
    assert.equal(stats.filtered_versions, 2);
    assert.equal(integrity.listings["custom-mod"]?.versions["1.0.0"]?.is_complete, true);
    assert.equal(typeof integrity.listings["custom-mod"]?.versions["1.0.0"]?.release_size, "number");
    assert.equal(integrity.listings["custom-mod"]?.versions["1.1.0"]?.is_complete, false);
    assert.equal(integrity.listings["custom-mod"]?.versions["1.2.0"]?.is_complete, false);
    assert.equal(integrity.listings["custom-mod"]?.versions["beta"]?.is_complete, false);
    assert.ok(
      (integrity.listings["custom-mod"]?.versions["beta"]?.errors ?? []).some((error) => error.includes("non-semver")),
    );
  });
});

test("download-only mode preserves previous downloads when a GitHub repo is temporarily unavailable", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["github-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "github-mod", {
      ...makeBaseModManifest("github-mod"),
      update: { type: "github", repo: "owner/good" },
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "github-mod": {
        "v2.0.0": 14,
      },
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-31T00:00:00.000Z",
      listings: {
        "github-mod": {
          has_complete_version: true,
          latest_semver_version: "v2.0.0",
          latest_semver_complete: true,
          complete_versions: ["v2.0.0"],
          incomplete_versions: [],
          versions: {
            "v2.0.0": {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              source: { update_type: "github", repo: "owner/good", tag: "v2.0.0" },
              fingerprint: "fp",
              checked_at: "2026-03-31T00:00:00.000Z",
            },
          },
        },
      },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => new Response("upstream unavailable", { status: 503 }),
      },
    ]);

    const { downloads, warnings } = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      mode: "download-only",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(downloads, {
      "github-mod": {
        "v2.0.0": 14,
      },
    });
    assert.ok(
      warnings.some((warning) => warning.includes("preserved previous github-release downloads (repo unavailable)")),
    );
  });
});

test("full mode preserves previous integrity and downloads when a GitHub repo is temporarily unavailable", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["github-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "github-mod", {
      ...makeBaseModManifest("github-mod"),
      update: { type: "github", repo: "owner/good" },
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "github-mod": {
        "v2.0.0": 14,
      },
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-31T00:00:00.000Z",
      listings: {
        "github-mod": {
          has_complete_version: true,
          latest_semver_version: "v2.0.0",
          latest_semver_complete: true,
          complete_versions: ["v2.0.0"],
          incomplete_versions: [],
          versions: {
            "v2.0.0": {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              source: { update_type: "github", repo: "owner/good", tag: "v2.0.0" },
              fingerprint: "fp",
              checked_at: "2026-03-31T00:00:00.000Z",
            },
          },
        },
      },
    });
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), {
      schema_version: 1,
      entries: {
        "github-mod": {
          "v2.0.0": {
            fingerprint: "fp",
            last_checked_at: "2026-03-31T00:00:00.000Z",
            result: {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              source: { update_type: "github", repo: "owner/good", tag: "v2.0.0" },
              fingerprint: "fp",
              checked_at: "2026-03-31T00:00:00.000Z",
            },
          },
        },
      },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => new Response("upstream unavailable", { status: 503 }),
      },
    ]);

    const { downloads, integrity, warnings } = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(downloads, {
      "github-mod": {
        "v2.0.0": 14,
      },
    });
    assert.equal(integrity.listings["github-mod"]?.has_complete_version, true);
    assert.equal(integrity.listings["github-mod"]?.versions["v2.0.0"]?.is_complete, true);
    assert.ok(
      warnings.some((warning) => warning.includes("preserved previous integrity and download state (repo unavailable)")),
    );
  });
});

test("custom-update maps can use game_version from the custom JSON without a release manifest", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("maps", ["custom-json-map"]);
    writeIndex("mods", []);
    writeManifest("maps", "custom-json-map", {
      ...makeBaseMapManifest("custom-json-map"),
      update: { type: "custom", url: "https://example.com/custom-json-map-update.json" },
    });

    const validZip = await makeMapZip("ABC", "1.0.0");
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/custom-json-map-update.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              game_version: "<=1.4.0",
              date: "2026-06-24",
              download: "https://github.com/Owner/CustomJsonMap/releases/download/v1.0.0/map.zip",
              sha256: "sha-custom-json-map",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/map.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "map.zip", downloadCount: 11, downloadUrl: "https://downloads.example.com/map.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.equal(result.integrity.listings["custom-json-map"]?.versions["1.0.0"]?.is_complete, true);
    assert.equal(result.downloads["custom-json-map"]?.["1.0.0"], 10);
  });
});

test("custom versions sharing the same release asset reuse a single ZIP inspection", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["shared-asset-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "shared-asset-mod", {
      ...makeBaseModManifest("shared-asset-mod"),
      update: { type: "custom", url: "https://example.com/shared-asset-update.json" },
    });

    const validZip = await makeModZip(true);
    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/shared-asset-update.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://github.com/Owner/Shared/releases/download/v1.0.0/shared.zip",
            },
            {
              version: "1.0.1",
              download: "https://github.com/Owner/Shared/releases/download/v1.0.0/shared.zip",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/shared.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(validZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "shared.zip", downloadCount: 21, downloadUrl: "https://downloads.example.com/shared.zip" },
                        { name: "manifest.json", downloadCount: 21, downloadUrl: "https://downloads.example.com/shared-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(result.downloads, {
      "shared-asset-mod": {
        "1.0.0": 20,
      },
    });
    assert.equal(zipFetchCount, 1);
    assert.equal(result.stats.registry_fetches_added, 1);
    assert.equal(result.stats.adjusted_delta_total, 2);
    assert.equal(result.integrity.listings["shared-asset-mod"]?.versions["1.0.0"]?.is_complete, true);
    assert.equal(result.integrity.listings["shared-asset-mod"]?.versions["1.0.1"]?.is_complete, false);
    assert.ok(
      (result.integrity.listings["shared-asset-mod"]?.versions["1.0.1"]?.errors ?? [])
        .some((e) => e.includes("does not match release tag")),
    );
  });
});

test("sha256-based custom versions reuse cache regardless of age with versioned fingerprints", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["sha-cache-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "sha-cache-mod", {
      ...makeBaseModManifest("sha-cache-mod"),
      update: { type: "custom", url: "https://example.com/sha-cache-update.json" },
    });

    const validZip = await makeModZip(true);
    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/sha-cache-update.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://github.com/Owner/ShaCache/releases/download/v1.0.0/mod.zip",
              sha256: "sha-cache-hash-1",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/sha-cache-mod.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(validZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "mod.zip", downloadCount: 7, downloadUrl: "https://downloads.example.com/sha-cache-mod.zip" },
                        { name: "manifest.json", downloadCount: 7, downloadUrl: "https://downloads.example.com/sha-cache-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const first = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(zipFetchCount, 1);

    const agedCache = JSON.parse(JSON.stringify(first.integrityCache)) as {
      entries: Record<string, Record<string, { last_checked_at: string }>>;
    };
    agedCache.entries["sha-cache-mod"]["1.0.0"].last_checked_at = "2001-01-01T00:00:00.000Z";
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), agedCache);

    const second = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(second.stats.cache_hits, 1);
    assert.equal(zipFetchCount, 1);
    assert.deepEqual(second.downloads, { "sha-cache-mod": { "1.0.0": 7 } });
  });
});

test("custom mod integrity honors versions[].manifest asset name when checking release assets", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["custom-manifest-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "custom-manifest-mod", {
      ...makeBaseModManifest("custom-manifest-mod"),
      update: { type: "custom", url: "https://example.com/custom-update-manifest.json" },
    });

    const validZip = await makeModZip(true, "0.1.0");
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/custom-update-manifest.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "0.1.0",
              download: "https://github.com/Owner/ManifestMod/releases/download/v0.1.3/mod-nested.zip",
              manifest: "https://github.com/Owner/ManifestMod/releases/download/v0.1.3/manifest-nested.json",
              sha256: "sha-manifest",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/mod-nested.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v0.1.3",
                    releaseAssets: {
                      nodes: [
                        { name: "mod-nested.zip", downloadCount: 13, downloadUrl: "https://downloads.example.com/mod-nested.zip" },
                        { name: "manifest-nested.json", downloadCount: 13, downloadUrl: "https://downloads.example.com/manifest-nested.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(result.downloads, {
      "custom-manifest-mod": {
        "0.1.0": 12,
      },
    });
    assert.equal(result.integrity.listings["custom-manifest-mod"]?.versions["0.1.0"]?.is_complete, true);
    assert.equal(result.stats.registry_fetches_added, 1);
    assert.equal(result.stats.adjusted_delta_total, 1);
    assert.equal(result.stats.filtered_versions, 0);
  });
});

test("mod non-sha integrity cache reuses matching fingerprints regardless of cache age", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["cache-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "cache-mod", {
      ...makeBaseModManifest("cache-mod"),
      update: { type: "github", repo: "owner/cache" },
    });

    const validZip = await makeModZip(true);
    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/cache.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(validZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "cache.zip", downloadCount: 3, downloadUrl: "https://downloads.example.com/cache.zip" },
                        { name: "manifest.json", downloadCount: 3, downloadUrl: "https://downloads.example.com/cache-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const first = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(zipFetchCount, 1);
    const agedCache = JSON.parse(JSON.stringify(first.integrityCache)) as {
      entries: Record<string, Record<string, { last_checked_at: string }>>;
    };
    agedCache.entries["cache-mod"]["v1.0.0"].last_checked_at = "2001-01-01T00:00:00.000Z";
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), agedCache);

    const second = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(second.stats.cache_hits, 1);
    assert.equal(zipFetchCount, 1);
    assert.deepEqual(second.downloads, { "cache-mod": { "v1.0.0": 3 } });
  });
});

test("download-only mode skips ZIP inspection and keeps semver zip counts", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["hourly-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "hourly-mod", {
      ...makeBaseModManifest("hourly-mod"),
      update: { type: "github", repo: "owner/hourly" },
    });

    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/hourly.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response("unexpected");
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "hourly.zip", downloadCount: 7, downloadUrl: "https://downloads.example.com/hourly.zip" },
                        { name: "manifest.json", downloadCount: 7, downloadUrl: "https://downloads.example.com/hourly-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      mode: "download-only",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(result.downloads, { "hourly-mod": { "v1.0.0": 7 } });
    assert.equal(result.stats.filtered_versions, 0);
    assert.equal(zipFetchCount, 0);
  });
});

test("download-only mode subtracts registry-attributed fetches from raw counts", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["hourly-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "hourly-mod", {
      ...makeBaseModManifest("hourly-mod"),
      update: { type: "github", repo: "owner/hourly" },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "hourly.zip", downloadCount: 7, downloadUrl: "https://downloads.example.com/hourly.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const ledger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
    ledger.assets["owner/hourly@v1.0.0/hourly.zip"] = {
      count: 3,
      updated_at: "2026-03-30T00:00:00.000Z",
      by_source: { "workflow:test": 3 },
    };
    const delta = createDownloadAttributionDelta("workflow:test", "run-1", "2026-03-30T01:00:00.000Z");

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      mode: "download-only",
      fetchImpl: fetchMock,
      token: "test-token",
      attribution: {
        ledger,
        delta,
      },
    });

    assert.deepEqual(result.downloads, { "hourly-mod": { "v1.0.0": 4 } });
    assert.equal(result.stats.adjusted_delta_total, 3);
    assert.equal(result.stats.clamped_versions, 0);
  });
});

test("full mode records ZIP fetch attribution deltas on successful fetches", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["github-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "github-mod", {
      ...makeBaseModManifest("github-mod"),
      update: { type: "github", repo: "owner/good" },
    });

    const validZip = await makeModZip(true, "2.0.0");
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://github.com/owner/good/releases/download/v2.0.0/good-v2.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v2.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "good-v2.zip", downloadCount: 15, downloadUrl: "https://github.com/owner/good/releases/download/v2.0.0/good-v2.zip" },
                        { name: "manifest.json", downloadCount: 15, downloadUrl: "https://downloads.example.com/manifest-v2.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const ledger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
    const delta = createDownloadAttributionDelta("workflow:test", "run-2", "2026-03-30T01:00:00.000Z");

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
      attribution: {
        ledger,
        delta,
      },
    });

    assert.deepEqual(result.downloads, { "github-mod": { "v2.0.0": 14 } });
    assert.equal(result.stats.registry_fetches_added, 1);
    assert.equal(result.stats.adjusted_delta_total, 1);
    assert.equal(delta.assets["owner/good@v2.0.0/good-v2.zip"], 1);
  });
});

test("download-only mode scrubs versions that are not complete in integrity snapshot", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["hourly-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "hourly-mod", {
      ...makeBaseModManifest("hourly-mod"),
      update: { type: "github", repo: "owner/hourly" },
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-14T00:00:00Z",
      listings: {
        "hourly-mod": {
          has_complete_version: true,
          latest_semver_version: "v1.0.1",
          latest_semver_complete: true,
          complete_versions: ["v1.0.1"],
          incomplete_versions: ["v1.0.0"],
          versions: {
            "v1.0.0": {
              is_complete: false,
              errors: ["missing top-level manifest.json in ZIP"],
              required_checks: {},
              matched_files: {},
              source: { update_type: "github", repo: "owner/hourly", tag: "v1.0.0" },
              fingerprint: "github:owner/hourly:v1.0.0:hourly-v1.0.0.zip",
              checked_at: "2026-03-14T00:00:00Z",
            },
            "v1.0.1": {
              is_complete: true,
              errors: [],
              required_checks: {
                release_manifest_asset: true,
                zip_manifest_json: true,
              },
              matched_files: {
                release_manifest_asset: "manifest.json",
                zip_manifest_json: "manifest.json",
              },
              source: {
                update_type: "github",
                repo: "owner/hourly",
                tag: "v1.0.1",
                asset_name: "hourly-v1.0.1.zip",
                download_url: "https://downloads.example.com/hourly-v1.0.1.zip",
              },
              fingerprint: "github:owner/hourly:v1.0.1:hourly-v1.0.1.zip",
              checked_at: "2026-03-14T00:00:00Z",
            },
          },
        },
      },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.1",
                    releaseAssets: {
                      nodes: [
                        { name: "hourly-v1.0.1.zip", downloadCount: 9, downloadUrl: "https://downloads.example.com/hourly-v1.0.1.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "hourly-v1.0.0.zip", downloadCount: 7, downloadUrl: "https://downloads.example.com/hourly-v1.0.0.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      mode: "download-only",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(result.downloads, { "hourly-mod": { "v1.0.1": 9 } });
    assert.equal(result.stats.filtered_versions, 1);
    assert.ok(
      result.warnings.some((warning) => warning.includes("v1.0.0") && warning.includes("excluded by integrity snapshot")),
    );
  });
});

test("map complete versions include file_sizes and legacy cache entries without file_sizes are recomputed", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("maps", ["cache-map"]);
    writeIndex("mods", []);
    writeManifest("maps", "cache-map", {
      ...makeBaseMapManifest("cache-map"),
      update: { type: "github", repo: "owner/maprepo" },
    });

    const mapZip = await makeMapZip("ABC");
    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/map-v1.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(mapZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "map-v1.zip", downloadCount: 11, downloadUrl: "https://downloads.example.com/map-v1.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const first = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(zipFetchCount, 1);
    assert.deepEqual(first.downloads, { "cache-map": { "v1.0.0": 10 } });
    assert.equal(first.stats.registry_fetches_added, 1);
    assert.equal(first.stats.adjusted_delta_total, 1);
    const firstVersion = first.integrity.listings["cache-map"]?.versions["v1.0.0"];
    assert.equal(firstVersion?.is_complete, true);
    assert.equal(typeof firstVersion?.release_size, "number");
    assert.equal(typeof firstVersion?.file_sizes?.["config.json"], "number");
    assert.equal(typeof firstVersion?.file_sizes?.["ABC.pmtiles"], "number");

    const legacyCache = JSON.parse(JSON.stringify(first.integrityCache)) as {
      entries: Record<string, Record<string, { result?: { file_sizes?: unknown } }>>;
    };
    if (legacyCache.entries["cache-map"]?.["v1.0.0"]?.result) {
      delete legacyCache.entries["cache-map"]["v1.0.0"].result.file_sizes;
    }
    writeJson(join(repoRoot, "maps", "integrity-cache.json"), legacyCache);

    const second = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(zipFetchCount, 2);
    const secondVersion = second.integrity.listings["cache-map"]?.versions["v1.0.0"];
    assert.equal(secondVersion?.is_complete, true);
    assert.equal(typeof secondVersion?.release_size, "number");
    assert.equal(typeof secondVersion?.file_sizes?.["config.json"], "number");
    assert.equal(typeof secondVersion?.file_sizes?.["ABC.pmtiles"], "number");
  });
});

test("map integrity blocks downloads when a demand point is isolated by more than 100km", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("maps", ["isolated-map"]);
    writeIndex("mods", []);
    writeManifest("maps", "isolated-map", {
      ...makeBaseMapManifest("isolated-map"),
      update: { type: "github", repo: "owner/isolated-map" },
    });

    const mapZip = await makeMapZipWithPointLocations("ABC", [
      { id: "center-1", location: [0, 0] },
      { id: "center-2", location: [0.02, 0.02] },
      { id: "remote", location: [2, 2] },
    ]);
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/isolated-map.zip",
        handle: () => new Response(new Uint8Array(mapZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "isolated-map.zip", downloadCount: 11, downloadUrl: "https://downloads.example.com/isolated-map.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.deepEqual(result.downloads, { "isolated-map": {} });
    assert.equal(result.integrity.listings["isolated-map"]?.versions["v1.0.0"]?.is_complete, false);
    assert.equal(result.integrity.listings["isolated-map"]?.versions["v1.0.0"]?.required_checks.demand_point_spacing, false);
    assert.ok(
      (result.integrity.listings["isolated-map"]?.versions["v1.0.0"]?.errors ?? [])
        .some((error) => error.includes("isolated point(s)") && error.includes("remote")),
    );
    assert.ok(
      result.warnings.some((warning) => (
        warning.includes("isolated-map")
        && warning.includes("excluded by integrity validation")
        && warning.includes(">100km")
      )),
    );
  });
});

test("mod security ERROR findings block completeness and exclude downloads", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["security-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "security-mod", {
      ...makeBaseModManifest("security-mod"),
      update: { type: "github", repo: "owner/security" },
    });
    writeJson(join(repoRoot, "security-rules.json"), {
      schema_version: 1,
      rules: [
        {
          id: "forbidden-customSavesDirectory",
          severity: "ERROR",
          type: "literal",
          pattern: "customSavesDirectory",
        },
      ],
    });

    const zipBuffer = await makeModZipWithSources(true, {
      "index.js": "const x = customSavesDirectory;",
    });
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/security-mod.zip",
        handle: () => new Response(new Uint8Array(zipBuffer)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "security-mod.zip", downloadCount: 22, downloadUrl: "https://downloads.example.com/security-mod.zip" },
                        { name: "manifest.json", downloadCount: 22, downloadUrl: "https://downloads.example.com/manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.deepEqual(result.downloads, { "security-mod": {} });
    assert.equal(result.integrity.listings["security-mod"]?.versions["v1.0.0"]?.is_complete, false);
    assert.equal(result.integrity.listings["security-mod"]?.versions["v1.0.0"]?.required_checks.security_scan_passed, false);
    assert.equal(
      result.integrity.listings["security-mod"]?.versions["v1.0.0"]?.security_issue?.findings[0]?.rule_id,
      "forbidden-customSavesDirectory",
    );
  });
});

test("mod security WARNING findings are recorded but do not block completeness", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["warning-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "warning-mod", {
      ...makeBaseModManifest("warning-mod"),
      update: { type: "github", repo: "owner/warning" },
    });
    writeJson(join(repoRoot, "security-rules.json"), {
      schema_version: 1,
      rules: [
        {
          id: "suspicious-eval-atob",
          severity: "WARNING",
          type: "regex",
          pattern: "eval\\s*\\(\\s*atob\\s*\\(",
        },
      ],
    });

    const zipBuffer = await makeModZipWithSources(true, {
      "main.ts": "const x = eval(atob('Zm9v'));",
    });
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/warning-mod.zip",
        handle: () => new Response(new Uint8Array(zipBuffer)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "warning-mod.zip", downloadCount: 5, downloadUrl: "https://downloads.example.com/warning-mod.zip" },
                        { name: "manifest.json", downloadCount: 5, downloadUrl: "https://downloads.example.com/manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.deepEqual(result.downloads, { "warning-mod": { "v1.0.0": 4 } });
    assert.equal(result.stats.registry_fetches_added, 1);
    assert.equal(result.stats.adjusted_delta_total, 1);
    assert.equal(result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.is_complete, true);
    assert.equal(result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.required_checks.security_scan_passed, true);
    assert.equal(
      result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.security_issue?.findings[0]?.severity,
      "WARNING",
    );
  });
});

// --- Behavior locks for the 429-cascade incident class ---------------------
// These tests pin the exact preservation semantics of generateDownloadsDataFull
// so that refactors cannot silently change them.

test("full mode preserves previous integrity, cache, and downloads when a custom update JSON returns HTTP 429", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["custom-429-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "custom-429-mod", {
      ...makeBaseModManifest("custom-429-mod"),
      update: { type: "custom", url: "https://example.com/custom-429-update.json" },
    });

    const previousVersionEntry = {
      is_complete: true,
      errors: [],
      required_checks: { release_manifest_asset: true, zip_manifest_json: true, security_scan_passed: true },
      matched_files: { release_manifest_asset: "manifest.json", zip_manifest_json: "manifest.json", security_scan_passed: "passed" },
      source: {
        update_type: "custom",
        repo: "owner/four29",
        tag: "v1.0.0",
        asset_name: "four29.zip",
        download_url: "https://github.com/owner/four29/releases/download/v1.0.0/four29.zip",
      },
      fingerprint: "fp-custom-429",
      checked_at: "2026-03-31T00:00:00.000Z",
    };
    const previousListingEntry = {
      has_complete_version: true,
      latest_semver_version: "1.0.0",
      latest_semver_complete: true,
      complete_versions: ["1.0.0"],
      incomplete_versions: [],
      versions: { "1.0.0": previousVersionEntry },
    };
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "custom-429-mod": { "1.0.0": 42 },
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-31T00:00:00.000Z",
      listings: { "custom-429-mod": previousListingEntry },
    });
    // The seeded cache entry includes asset_updated_at; loadIntegrityCache
    // round-trips it, so the preserved cache output carries it too.
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), {
      schema_version: 1,
      entries: {
        "custom-429-mod": {
          "1.0.0": {
            fingerprint: "fp-custom-429",
            last_checked_at: "2026-03-31T00:00:00.000Z",
            result: previousVersionEntry,
            asset_updated_at: { "four29.zip": "2026-03-30T00:00:00Z" },
          },
        },
      },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/custom-429-update.json",
        handle: () => new Response("rate limited", { status: 429 }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.ok(result.warnings.includes(
      "listing=custom-429-mod: custom update JSON returned HTTP 429 (transient; previous counts preserved)",
    ));
    assert.ok(result.warnings.includes(
      "listing=custom-429-mod: preserved previous custom-update downloads (transient fetch error)",
    ));
    assert.ok(result.warnings.includes(
      "listing=custom-429-mod: preserved previous integrity state (transient custom-update fetch error)",
    ));

    assert.deepEqual(result.downloads, {
      "custom-429-mod": { "1.0.0": 42 },
    });
    assert.deepEqual(result.integrity.listings["custom-429-mod"], previousListingEntry);
    assert.deepEqual(result.integrityCache.entries["custom-429-mod"], {
      "1.0.0": {
        fingerprint: "fp-custom-429",
        last_checked_at: "2026-03-31T00:00:00.000Z",
        result: previousVersionEntry,
        asset_updated_at: { "four29.zip": "2026-03-30T00:00:00Z" },
      },
    });
    assert.equal(result.stats.versions_checked, 0);
    assert.equal(result.stats.complete_versions, 1);
    assert.equal(result.stats.incomplete_versions, 0);
    assert.deepEqual(result.integrityAlerts, []);
  });
});

test("full mode grandfathers a previously-complete github version when fresh inspection fails only grandfathered checks", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("maps", ["grandfather-map"]);
    writeIndex("mods", []);
    writeManifest("maps", "grandfather-map", {
      ...makeBaseMapManifest("grandfather-map"),
      update: { type: "github", repo: "owner/gfmap" },
    });

    const previousVersionEntry = {
      is_complete: true,
      errors: [],
      required_checks: {
        config_json: true,
        demand_data: true,
        buildings_index: true,
        roads_geojson: true,
        runways_taxiways_geojson: true,
        city_pmtiles: true,
        config_version_matches_tag: true,
      },
      matched_files: {},
      source: { update_type: "github", repo: "owner/gfmap", tag: "v1.0.0" },
      fingerprint: "fp-old",
      checked_at: "2026-03-31T00:00:00.000Z",
    };
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-31T00:00:00.000Z",
      listings: {
        "grandfather-map": {
          has_complete_version: true,
          latest_semver_version: "v1.0.0",
          latest_semver_complete: true,
          complete_versions: ["v1.0.0"],
          incomplete_versions: [],
          versions: { "v1.0.0": previousVersionEntry },
        },
      },
    });
    // No integrity-cache.json: forces the fresh-inspection path.

    const phantomZip = await makeMapZipWithPhantomPoint("ABC");
    let zipFetchCount = 0;
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/gfmap.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(phantomZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        {
                          id: "asset-node-gfmap",
                          name: "gfmap.zip",
                          downloadCount: 9,
                          downloadUrl: "https://downloads.example.com/gfmap.zip",
                          size: 12345,
                          updatedAt: "2026-04-01T00:00:00Z",
                        },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.equal(zipFetchCount, 1);
    assert.ok(result.warnings.includes(
      "listing=grandfather-map version=v1.0.0: preserved previous is_complete=true (grandfathered checks: demand_phantom_points)",
    ));

    // The previous complete entry is preserved verbatim (never-downgrade guard).
    assert.deepEqual(result.integrity.listings["grandfather-map"]?.versions["v1.0.0"], previousVersionEntry);
    assert.equal(result.integrity.listings["grandfather-map"]?.has_complete_version, true);
    assert.deepEqual(result.integrity.listings["grandfather-map"]?.complete_versions, ["v1.0.0"]);

    // Downloads stay live: raw 9 minus the 1 registry-attributed inspection fetch.
    assert.deepEqual(result.downloads, { "grandfather-map": { "v1.0.0": 8 } });

    // The grandfathered cache entry carries the preserved result plus the
    // current asset clobber metadata from the release index.
    const cacheEntry = result.integrityCache.entries["grandfather-map"]?.["v1.0.0"];
    assert.deepEqual(cacheEntry?.result, previousVersionEntry);
    assert.deepEqual(cacheEntry?.asset_sizes, { "gfmap.zip": 12345 });
    assert.deepEqual(cacheEntry?.asset_updated_at, { "gfmap.zip": "2026-04-01T00:00:00Z" });

    assert.deepEqual(result.integrityAlerts, []);
    assert.equal(result.stats.versions_checked, 1);
    assert.equal(result.stats.cache_hits, 0);
    assert.equal(result.stats.complete_versions, 1);
    assert.equal(result.stats.incomplete_versions, 0);
    assert.equal(result.stats.filtered_versions, 0);
  });
});

test("full mode grandfathers a previously-complete custom version when fresh inspection fails only grandfathered checks", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("maps", ["grandfather-custom-map"]);
    writeIndex("mods", []);
    writeManifest("maps", "grandfather-custom-map", {
      ...makeBaseMapManifest("grandfather-custom-map"),
      update: { type: "custom", url: "https://example.com/grandfather-custom-update.json" },
    });

    const previousVersionEntry = {
      is_complete: true,
      errors: [],
      required_checks: {
        config_json: true,
        demand_data: true,
        buildings_index: true,
        roads_geojson: true,
        runways_taxiways_geojson: true,
        city_pmtiles: true,
        config_version_matches_tag: true,
      },
      matched_files: {},
      source: {
        update_type: "custom",
        repo: "owner/gfcustom",
        tag: "v1.0.0",
        asset_name: "gfcustom.zip",
        download_url: "https://github.com/Owner/GfCustom/releases/download/v1.0.0/gfcustom.zip",
      },
      fingerprint: "fp-old-custom",
      checked_at: "2026-03-31T00:00:00.000Z",
    };
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-31T00:00:00.000Z",
      listings: {
        "grandfather-custom-map": {
          has_complete_version: true,
          latest_semver_version: "1.0.0",
          latest_semver_complete: true,
          complete_versions: ["1.0.0"],
          incomplete_versions: [],
          versions: { "1.0.0": previousVersionEntry },
        },
      },
    });
    // No integrity-cache.json: forces the fresh-inspection path.

    const phantomZip = await makeMapZipWithPhantomPoint("ABC");
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://example.com/grandfather-custom-update.json",
        handle: () => jsonResponse({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://github.com/Owner/GfCustom/releases/download/v1.0.0/gfcustom.zip",
            },
          ],
        }),
      },
      {
        match: (url) => url === "https://downloads.example.com/gfcustom.zip",
        handle: () => new Response(new Uint8Array(phantomZip)),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "gfcustom.zip", downloadCount: 6, downloadUrl: "https://downloads.example.com/gfcustom.zip" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "map",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    assert.ok(result.warnings.includes(
      "listing=grandfather-custom-map version=1.0.0: preserved previous is_complete=true (grandfathered checks: demand_phantom_points)",
    ));
    assert.deepEqual(
      result.integrity.listings["grandfather-custom-map"]?.versions["1.0.0"],
      previousVersionEntry,
    );
    assert.equal(result.integrity.listings["grandfather-custom-map"]?.has_complete_version, true);

    // Downloads stay live: raw 6 minus the 1 registry-attributed inspection fetch.
    assert.deepEqual(result.downloads, { "grandfather-custom-map": { "1.0.0": 5 } });

    const cacheEntry = result.integrityCache.entries["grandfather-custom-map"]?.["1.0.0"];
    assert.deepEqual(cacheEntry?.result, previousVersionEntry);
    // The custom grandfather site does not record asset clobber metadata.
    assert.equal(cacheEntry?.asset_sizes, undefined);
    assert.equal(cacheEntry?.asset_updated_at, undefined);

    assert.deepEqual(result.integrityAlerts, []);
    assert.equal(result.stats.complete_versions, 1);
    assert.equal(result.stats.incomplete_versions, 0);
    assert.equal(result.stats.cache_hits, 0);
  });
});

test("full mode detects a same-size asset replacement across runs and forces a re-check", async () => {
  // Fresh inspections write asset_sizes/asset_updated_at into
  // integrity-cache.json (downloads-full.ts); loadIntegrityCache round-trips
  // them so a cached entry whose asset_updated_at disagrees with the release
  // index is re-checked across runs — the clobber-detection scenario (e.g. a
  // config.json version bump replacing a ZIP without changing its size).
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["clobber-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "clobber-mod", {
      ...makeBaseModManifest("clobber-mod"),
      update: { type: "github", repo: "owner/clobber" },
    });

    const validZip = await makeModZip(true);
    let zipFetchCount = 0;
    let assetUpdatedAt = "2026-01-01T00:00:00Z";
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/clobber.zip",
        handle: () => {
          zipFetchCount += 1;
          return new Response(new Uint8Array(validZip));
        },
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        {
                          id: "asset-node-clobber",
                          name: "clobber.zip",
                          downloadCount: 5,
                          downloadUrl: "https://downloads.example.com/clobber.zip",
                          size: 4096,
                          updatedAt: assetUpdatedAt,
                        },
                        { name: "manifest.json", downloadCount: 5, downloadUrl: "https://downloads.example.com/clobber-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const first = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(zipFetchCount, 1);
    const firstCacheEntry = first.integrityCache.entries["clobber-mod"]?.["v1.0.0"];
    assert.deepEqual(firstCacheEntry?.asset_sizes, { "clobber.zip": 4096 });
    assert.deepEqual(firstCacheEntry?.asset_updated_at, { "clobber.zip": "2026-01-01T00:00:00Z" });

    // Persist the cache exactly as produced (including clobber metadata), then
    // simulate a same-size asset replacement by changing only updatedAt.
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), first.integrityCache);
    assetUpdatedAt = "2026-02-02T00:00:00Z";

    const second = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    // The stale entry's asset_updated_at disagrees with the release index, so
    // the cache is bypassed and the ZIP is re-fetched and re-inspected.
    assert.equal(second.stats.cache_hits, 0);
    assert.equal(zipFetchCount, 2);
    assert.ok(second.warnings.some((warning) => (
      warning.includes("zip asset replaced since last inspection; forcing re-check")
    )));
    // Raw count 5 minus this run's own registry-attributed ZIP fetch = 4
    // (same adjustment every fetching run applies).
    assert.deepEqual(second.downloads, { "clobber-mod": { "v1.0.0": 4 } });
    const secondCacheEntry = second.integrityCache.entries["clobber-mod"]?.["v1.0.0"];
    assert.deepEqual(secondCacheEntry?.asset_updated_at, { "clobber.zip": "2026-02-02T00:00:00Z" });
    assert.equal(second.integrity.listings["clobber-mod"]?.versions["v1.0.0"]?.is_complete, true);
  });
});

test("forceRecheckListings bypasses the cache for only the named listing and picks up a replaced release manifest", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["gv-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "gv-mod", {
      ...makeBaseModManifest("gv-mod"),
      update: { type: "github", repo: "Owner/GvMod" },
    });

    const validZip = await makeModZip(true);
    // The release's bundled manifest.json is mutable: retroactive game_version
    // edits replace this asset in place, which the zip-only fingerprint and
    // clobber detection cannot see.
    let releaseManifestGameRange = ">=1.0.0";
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/gv-mod.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://downloads.example.com/gv-manifest.json",
        handle: () => jsonResponse({
          dependencies: { "subway-builder": releaseManifestGameRange },
        }),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        { name: "mod.zip", downloadCount: 3, downloadUrl: "https://downloads.example.com/gv-mod.zip" },
                        { name: "manifest.json", downloadCount: 0, downloadUrl: "https://downloads.example.com/gv-manifest.json" },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const first = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(first.integrity.listings["gv-mod"]?.versions["v1.0.0"]?.game_version, ">=1.0.0");
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), first.integrityCache);

    // The author replaces the release's manifest.json (zip untouched): an
    // ordinary run reuses the cache and the old game_version sticks.
    releaseManifestGameRange = "<=1.3.0";
    const second = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });
    assert.equal(second.stats.cache_hits, 1);
    assert.equal(second.integrity.listings["gv-mod"]?.versions["v1.0.0"]?.game_version, ">=1.0.0");

    // Forcing a recheck for an UNRELATED listing still reuses the cache.
    const untargeted = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
      forceRecheckListings: ["some-other-mod"],
    });
    assert.equal(untargeted.stats.cache_hits, 1);
    assert.equal(untargeted.integrity.listings["gv-mod"]?.versions["v1.0.0"]?.game_version, ">=1.0.0");

    // Targeting the listing bypasses its cache and re-parses game_version.
    const forced = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
      forceRecheckListings: ["gv-mod"],
    });
    assert.equal(forced.stats.cache_hits, 0);
    assert.equal(forced.integrity.listings["gv-mod"]?.versions["v1.0.0"]?.game_version, "<=1.3.0");
    assert.equal(forced.integrity.listings["gv-mod"]?.versions["v1.0.0"]?.is_complete, true);
  });
});

test("manifest.json asset replacement is auto-detected via updatedAt tracking; legacy entries backfill without invalidation", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["auto-gv-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "auto-gv-mod", {
      ...makeBaseModManifest("auto-gv-mod"),
      update: { type: "github", repo: "Owner/AutoGvMod" },
    });

    const validZip = await makeModZip(true);
    let releaseManifestGameRange = ">=1.0.0";
    let manifestAssetUpdatedAt = "2026-01-01T00:00:00Z";
    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://downloads.example.com/auto-gv-mod.zip",
        handle: () => new Response(new Uint8Array(validZip)),
      },
      {
        match: (url) => url === "https://downloads.example.com/auto-gv-manifest.json",
        handle: () => jsonResponse({
          dependencies: { "subway-builder": releaseManifestGameRange },
        }),
      },
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: () => jsonResponse({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.0.0",
                    releaseAssets: {
                      nodes: [
                        {
                          name: "mod.zip",
                          downloadCount: 3,
                          downloadUrl: "https://downloads.example.com/auto-gv-mod.zip",
                          updatedAt: "2026-01-01T00:00:00Z",
                        },
                        {
                          name: "manifest.json",
                          downloadCount: 0,
                          downloadUrl: "https://downloads.example.com/auto-gv-manifest.json",
                          updatedAt: manifestAssetUpdatedAt,
                        },
                      ],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      },
    ]);

    const run = () => generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    const first = await run();
    assert.equal(first.integrity.listings["auto-gv-mod"]?.versions["v1.0.0"]?.game_version, ">=1.0.0");
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), first.integrityCache);

    const second = await run();
    assert.equal(second.stats.cache_hits, 1);

    // Author replaces manifest.json (new updatedAt, new range): the regular
    // run detects it and re-parses game_version — no manual force needed.
    releaseManifestGameRange = "<=1.3.0";
    manifestAssetUpdatedAt = "2026-08-04T00:00:00Z";
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), second.integrityCache);
    const third = await run();
    assert.equal(third.stats.cache_hits, 0);
    assert.equal(third.integrity.listings["auto-gv-mod"]?.versions["v1.0.0"]?.game_version, "<=1.3.0");

    // Legacy entry (no manifest tracking recorded): a manifest change is NOT
    // detected — the entry is backfilled silently instead of invalidated...
    const legacyCache = JSON.parse(JSON.stringify(third.integrityCache)) as {
      entries: Record<string, Record<string, { manifest_asset_updated_at?: string | null }>>;
    };
    delete legacyCache.entries["auto-gv-mod"]["v1.0.0"].manifest_asset_updated_at;
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), legacyCache);
    releaseManifestGameRange = ">=1.0.0 <=1.2.0";
    manifestAssetUpdatedAt = "2026-08-05T00:00:00Z";
    const backfillRun = await run();
    assert.equal(backfillRun.stats.cache_hits, 1);
    assert.equal(backfillRun.integrity.listings["auto-gv-mod"]?.versions["v1.0.0"]?.game_version, "<=1.3.0");

    // ...and once backfilled, the NEXT change is detected normally.
    writeJson(join(repoRoot, "mods", "integrity-cache.json"), backfillRun.integrityCache);
    manifestAssetUpdatedAt = "2026-08-06T00:00:00Z";
    const afterBackfill = await run();
    assert.equal(afterBackfill.stats.cache_hits, 0);
    assert.equal(afterBackfill.integrity.listings["auto-gv-mod"]?.versions["v1.0.0"]?.game_version, ">=1.0.0 <=1.2.0");
  });
});

test("repo-level fetch warnings are suppressed for repos referenced only by deprecated listings", async () => {
  await withTempRegistry(async ({ repoRoot, writeIndex, writeManifest }) => {
    writeIndex("mods", ["dead-deprecated-mod", "dead-active-mod"]);
    writeIndex("maps", []);
    writeManifest("mods", "dead-deprecated-mod", {
      ...makeBaseModManifest("dead-deprecated-mod"),
      update: { type: "github", repo: "Gone/DeprecatedRepo" },
      deprecation: { since: "2026-08-01T00:00:00Z", by_github_id: 1 },
    });
    writeManifest("mods", "dead-active-mod", {
      ...makeBaseModManifest("dead-active-mod"),
      update: { type: "github", repo: "Gone/ActiveRepo" },
    });

    const fetchMock = makeFetchRouter([
      {
        match: (url) => url === "https://api.github.com/graphql",
        handle: async (_input, init) => {
          const body = String(init?.body ?? "");
          const repoName = body.includes("DeprecatedRepo") ? "Gone/DeprecatedRepo" : "Gone/ActiveRepo";
          return jsonResponse({
            errors: [
              { message: `Could not resolve to a Repository with the name '${repoName}'.` },
            ],
          });
        },
      },
    ]);

    const result = await generateDownloadsData({
      repoRoot,
      listingType: "mod",
      fetchImpl: fetchMock,
      token: "test-token",
    });

    const repoWarnings = result.warnings.filter((w) => w.includes("Could not resolve to a Repository"));
    assert.equal(
      repoWarnings.some((w) => w.includes("Gone/ActiveRepo".toLowerCase()) || w.includes("gone/activerepo")),
      true,
      `expected active-repo warning, got: ${JSON.stringify(result.warnings)}`,
    );
    assert.equal(
      repoWarnings.some((w) => w.toLowerCase().includes("gone/deprecatedrepo")),
      false,
      `deprecated-only repo warning leaked: ${JSON.stringify(result.warnings)}`,
    );
  });
});
