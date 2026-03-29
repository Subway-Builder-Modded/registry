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

async function makeModZip(includeTopLevelManifest: boolean): Promise<Buffer> {
  const zip = new JSZip();
  if (includeTopLevelManifest) {
    zip.file("manifest.json", "{\"schema_version\":1}");
  }
  zip.file("mod.dll", "binary");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeModZipWithSources(
  includeTopLevelManifest: boolean,
  sources: Record<string, string>,
): Promise<Buffer> {
  const zip = new JSZip();
  if (includeTopLevelManifest) {
    zip.file("manifest.json", "{\"schema_version\":1}");
  }
  zip.file("mod.dll", "binary");
  for (const [path, source] of Object.entries(sources)) {
    zip.file(path, source);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makeMapZip(cityCode: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("config.json", JSON.stringify({ code: cityCode }));
  zip.file("demand_data.json", "{}");
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

    const validZip = await makeModZip(true);
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
        "v2.0.0": 15,
      },
    });
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
        "1.0.0": 12,
      },
    });
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
        "1.0.0": 21,
        "1.0.1": 21,
      },
    });
    assert.equal(zipFetchCount, 1);
    assert.equal(result.integrity.listings["shared-asset-mod"]?.versions["1.0.0"]?.is_complete, true);
    assert.equal(result.integrity.listings["shared-asset-mod"]?.versions["1.0.1"]?.is_complete, true);
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
    assert.deepEqual(second.downloads, first.downloads);
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

    const validZip = await makeModZip(true);
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
        "0.1.0": 13,
      },
    });
    assert.equal(result.integrity.listings["custom-manifest-mod"]?.versions["0.1.0"]?.is_complete, true);
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
    assert.deepEqual(second.downloads, first.downloads);
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

    const validZip = await makeModZip(true);
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

    assert.deepEqual(result.downloads, { "github-mod": { "v2.0.0": 15 } });
    assert.equal(result.stats.registry_fetches_added, 1);
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
    assert.deepEqual(first.downloads, { "cache-map": { "v1.0.0": 11 } });
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
    assert.deepEqual(result.downloads, { "warning-mod": { "v1.0.0": 5 } });
    assert.equal(result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.is_complete, true);
    assert.equal(result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.required_checks.security_scan_passed, true);
    assert.equal(
      result.integrity.listings["warning-mod"]?.versions["v1.0.0"]?.security_issue?.findings[0]?.severity,
      "WARNING",
    );
  });
});
