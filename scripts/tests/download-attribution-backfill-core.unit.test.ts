import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseAttributionBackfillLogHits,
  resolveMapDemandBackfillAssetKey,
} from "../lib/download-attribution-backfill-core.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

test("parseAttributionBackfillLogHits parses downloads and map-demand-stats fetch lines", () => {
  const hits = parseAttributionBackfillLogHits(
    [
      "2026-04-01T01:02:03.000Z [downloads] heartbeat:end fetch-zip listing=sample-map version=v1.0.0 asset=sample.zip status=200 durationMs=1",
      "2026-04-01T01:05:00.000Z [map-demand-stats] heartbeat:end fetch-zip listing=bucharest-medium assetKey=owner/romania@v1.1.0/BUC.zip zipUrl=https://github.com/owner/romania/releases/download/v1.1.0/BUC.zip status=200 durationMs=1",
    ].join("\n"),
    "2026-04-01T00:00:00.000Z",
  );

  assert.deepEqual(hits, [
    {
      kind: "downloads",
      listingId: "sample-map",
      version: "v1.0.0",
      assetName: "sample.zip",
      generatedAt: "2026-04-01T01:02:03.000Z",
      dateKey: "2026_04_01",
    },
    {
      kind: "map-demand-stats",
      listingId: "bucharest-medium",
      assetKey: "owner/romania@v1.1.0/BUC.zip",
      zipUrl: "https://github.com/owner/romania/releases/download/v1.1.0/BUC.zip",
      generatedAt: "2026-04-01T01:05:00.000Z",
      dateKey: "2026_04_01",
    },
  ]);
});

test("resolveMapDemandBackfillAssetKey resolves github-backed map demand fetches", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-backfill-demand-github-"));
  mkdirSync(join(repoRoot, "maps", "bucharest-medium"), { recursive: true });

  try {
    writeJson(join(repoRoot, "maps", "bucharest-medium", "manifest.json"), {
      schema_version: 1,
      id: "bucharest-medium",
      name: "Bucharest",
      author: "test",
      github_id: 1,
      source: "https://github.com/owner/romania/releases/latest/download/BUC.zip",
      update: { type: "github", repo: "owner/romania" },
      city_code: "BUC",
      country: "RO",
    });

    const fetchMock: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.github.com/graphql") {
        return new Response(JSON.stringify({
          data: {
            repository: {
              releases: {
                nodes: [
                  {
                    tagName: "v1.1.0",
                    releaseAssets: {
                      nodes: [
                        {
                          name: "IAS.zip",
                          downloadCount: 1,
                          downloadUrl: "https://github.com/owner/romania/releases/download/v1.1.0/IAS.zip",
                        },
                        {
                          name: "BUC.zip",
                          downloadCount: 1,
                          downloadUrl: "https://github.com/owner/romania/releases/download/v1.1.0/BUC.zip",
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
              resetAt: "2026-04-01T00:00:00Z",
            },
          },
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    };

    const assetKey = await resolveMapDemandBackfillAssetKey(
      "bucharest-medium",
      repoRoot,
      "test-token",
      fetchMock,
    );

    assert.equal(assetKey, "owner/romania@v1.1.0/buc.zip");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resolveMapDemandBackfillAssetKey resolves custom github-release download URLs and skips non-github downloads", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-backfill-demand-custom-"));
  mkdirSync(join(repoRoot, "maps", "custom-github-map"), { recursive: true });
  mkdirSync(join(repoRoot, "maps", "custom-external-map"), { recursive: true });

  try {
    writeJson(join(repoRoot, "maps", "custom-github-map", "manifest.json"), {
      schema_version: 1,
      id: "custom-github-map",
      name: "Custom GitHub Map",
      author: "test",
      github_id: 1,
      source: "https://example.com/custom-github-map",
      update: { type: "custom", url: "https://example.com/custom-github-map/update.json" },
      city_code: "CGH",
      country: "US",
    });
    writeJson(join(repoRoot, "maps", "custom-external-map", "manifest.json"), {
      schema_version: 1,
      id: "custom-external-map",
      name: "Custom External Map",
      author: "test",
      github_id: 1,
      source: "https://example.com/custom-external-map",
      update: { type: "custom", url: "https://example.com/custom-external-map/update.json" },
      city_code: "CEX",
      country: "US",
    });

    const fetchMock: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://example.com/custom-github-map/update.json") {
        return new Response(JSON.stringify({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://github.com/example/maps/releases/download/v1.0.0/custom-map.zip",
            },
          ],
        }));
      }
      if (url === "https://example.com/custom-external-map/update.json") {
        return new Response(JSON.stringify({
          schema_version: 1,
          versions: [
            {
              version: "1.0.0",
              download: "https://example.com/custom-external-map/map.zip",
            },
          ],
        }));
      }
      throw new Error(`Unhandled fetch: ${url}`);
    };

    const githubAssetKey = await resolveMapDemandBackfillAssetKey(
      "custom-github-map",
      repoRoot,
      "test-token",
      fetchMock,
    );
    const externalAssetKey = await resolveMapDemandBackfillAssetKey(
      "custom-external-map",
      repoRoot,
      "test-token",
      fetchMock,
    );

    assert.equal(githubAssetKey, "example/maps@v1.0.0/custom-map.zip");
    assert.equal(externalAssetKey, null);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
