import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncMapFileSizesFromIntegrity } from "../sync-map-file-sizes.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function makeMapManifest(id: string): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    name: id,
    author: "tester",
    github_id: 1,
    description: "desc",
    tags: ["north-america"],
    gallery: ["gallery/1.webp"],
    source: "https://example.com",
    update: { type: "github", repo: "owner/repo" },
    city_code: "AAA",
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

interface TempRegistryContext {
  repoRoot: string;
}

async function withTempRegistry(
  run: (context: TempRegistryContext) => Promise<void>,
): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-sync-map-file-sizes-"));
  mkdirSync(join(repoRoot, "maps"), { recursive: true });

  try {
    await run({ repoRoot });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("sync script writes latest complete semver file_sizes into manifest", async () => {
  await withTempRegistry(async ({ repoRoot }) => {
    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["alpha-map"],
    });
    mkdirSync(join(repoRoot, "maps", "alpha-map"), { recursive: true });
    writeJson(join(repoRoot, "maps", "alpha-map", "manifest.json"), makeMapManifest("alpha-map"));
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-22T00:00:00Z",
      listings: {
        "alpha-map": {
          has_complete_version: true,
          latest_semver_version: "v1.1.0",
          latest_semver_complete: true,
          complete_versions: ["v1.1.0", "v1.0.0"],
          incomplete_versions: [],
          versions: {
            "v1.1.0": {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              file_sizes: {
                "AAA.pmtiles": 2.5,
                "config.json": 0.01,
              },
              source: { update_type: "github", repo: "owner/repo", tag: "v1.1.0" },
              fingerprint: "sha256:abc",
              checked_at: "2026-03-22T00:00:00Z",
            },
            "v1.0.0": {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              file_sizes: {
                "AAA.pmtiles": 1.9,
              },
              source: { update_type: "github", repo: "owner/repo", tag: "v1.0.0" },
              fingerprint: "sha256:def",
              checked_at: "2026-03-21T00:00:00Z",
            },
          },
        },
      },
    });

    const result = syncMapFileSizesFromIntegrity(repoRoot);
    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    const manifest = readJson<{ file_sizes: Record<string, number> }>(
      join(repoRoot, "maps", "alpha-map", "manifest.json"),
    );
    assert.deepEqual(manifest.file_sizes, {
      "AAA.pmtiles": 2.5,
      "config.json": 0.01,
    });
  });
});

test("sync script sets file_sizes to empty object when listing has no complete version", async () => {
  await withTempRegistry(async ({ repoRoot }) => {
    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["beta-map"],
    });
    mkdirSync(join(repoRoot, "maps", "beta-map"), { recursive: true });
    const manifest = makeMapManifest("beta-map");
    manifest.file_sizes = { "old.bin": 1.2 };
    writeJson(join(repoRoot, "maps", "beta-map", "manifest.json"), manifest);
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-22T00:00:00Z",
      listings: {
        "beta-map": {
          has_complete_version: false,
          latest_semver_version: "v1.0.0",
          latest_semver_complete: false,
          complete_versions: [],
          incomplete_versions: ["v1.0.0"],
          versions: {
            "v1.0.0": {
              is_complete: false,
              errors: ["missing top-level config.json"],
              required_checks: {},
              matched_files: {},
              source: { update_type: "github", repo: "owner/repo", tag: "v1.0.0" },
              fingerprint: "sha256:abc",
              checked_at: "2026-03-22T00:00:00Z",
            },
          },
        },
      },
    });

    const result = syncMapFileSizesFromIntegrity(repoRoot);
    assert.equal(result.processedMaps, 1);
    assert.equal(result.updatedMaps, 1);
    assert.equal(result.mapsWithoutCompleteVersion, 1);
    const updated = readJson<{ file_sizes: Record<string, number> }>(
      join(repoRoot, "maps", "beta-map", "manifest.json"),
    );
    assert.deepEqual(updated.file_sizes, {});
  });
});

test("sync script is idempotent when manifests are already synced", async () => {
  await withTempRegistry(async ({ repoRoot }) => {
    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["gamma-map"],
    });
    mkdirSync(join(repoRoot, "maps", "gamma-map"), { recursive: true });
    const manifest = makeMapManifest("gamma-map");
    manifest.file_sizes = {
      "AAA.pmtiles": 2.5,
      "config.json": 0.01,
    };
    writeJson(join(repoRoot, "maps", "gamma-map", "manifest.json"), manifest);
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-22T00:00:00Z",
      listings: {
        "gamma-map": {
          has_complete_version: true,
          latest_semver_version: "v1.1.0",
          latest_semver_complete: true,
          complete_versions: ["v1.1.0"],
          incomplete_versions: [],
          versions: {
            "v1.1.0": {
              is_complete: true,
              errors: [],
              required_checks: {},
              matched_files: {},
              file_sizes: {
                "AAA.pmtiles": 2.5,
                "config.json": 0.01,
              },
              source: { update_type: "github", repo: "owner/repo", tag: "v1.1.0" },
              fingerprint: "sha256:abc",
              checked_at: "2026-03-22T00:00:00Z",
            },
          },
        },
      },
    });

    const first = syncMapFileSizesFromIntegrity(repoRoot);
    assert.equal(first.updatedMaps, 0);
    const second = syncMapFileSizesFromIntegrity(repoRoot);
    assert.equal(second.updatedMaps, 0);
  });
});
