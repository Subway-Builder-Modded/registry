import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backfillDownloadHistorySnapshots, generateDownloadHistorySnapshot } from "../lib/download-history.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function setupBaseRepo(repoRoot: string): void {
  mkdirSync(join(repoRoot, "maps"), { recursive: true });
  mkdirSync(join(repoRoot, "mods"), { recursive: true });
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  writeJson(join(repoRoot, "maps", "index.json"), { schema_version: 1, maps: ["map-a"] });
  writeJson(join(repoRoot, "mods", "index.json"), { schema_version: 1, mods: ["mod-a"] });
}

function writeIntegrityWithSources(repoRoot: string): void {
  writeJson(join(repoRoot, "maps", "integrity.json"), {
    schema_version: 1,
    generated_at: "2026-03-30T00:00:00.000Z",
    listings: {
      "map-a": {
        versions: {
          "1.0.0": {
            is_complete: true,
            source: {
              update_type: "github",
              repo: "example/map",
              tag: "1.0.0",
              asset_name: "MAP.zip",
            },
          },
        },
      },
    },
  });
  writeJson(join(repoRoot, "mods", "integrity.json"), {
    schema_version: 1,
    generated_at: "2026-03-30T00:00:00.000Z",
    listings: {
      "mod-a": {
        versions: {
          "1.0.0": {
            is_complete: true,
            source: {
              update_type: "github",
              repo: "example/mod",
              tag: "1.0.0",
              asset_name: "mod.zip",
            },
          },
        },
      },
    },
  });
}

test("generateDownloadHistorySnapshot keeps all listed versions and derives raw via strict attribution mapping", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrityWithSources(repoRoot);
    writeJson(join(repoRoot, "maps", "downloads.json"), {
      "map-a": { "1.0.0": 10 },
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "mod-a": { "1.0.0": 5 },
    });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "example/map@1.0.0/MAP.zip": { count: 2, updated_at: "2026-03-30T00:00:00.000Z", by_source: {} },
        "example/mod@1.0.0/mod.zip": { count: 1, updated_at: "2026-03-30T00:00:00.000Z", by_source: {} },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_30": {
          total: 3,
          assets: {
            "example/map@1.0.0/MAP.zip": 2,
            "example/mod@1.0.0/mod.zip": 1,
          },
        },
      },
      timeline: {},
    });

    const result = generateDownloadHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-30T08:00:00.000Z"),
    });

    assert.equal(result.snapshot.total_downloads, 15);
    assert.equal(result.snapshot.raw_total_downloads, 18);
    assert.equal(result.snapshot.total_attributed_downloads, 3);
    assert.deepEqual(result.snapshot.maps.downloads, { "map-a": { "1.0.0": 10 } });
    assert.deepEqual(result.snapshot.maps.raw_downloads, { "map-a": { "1.0.0": 12 } });
    assert.deepEqual(result.snapshot.maps.attributed_downloads, { "map-a": { "1.0.0": 2 } });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots uses downloads as raw fallback and applies canonical 04:00 UTC cutoff", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrityWithSources(repoRoot);
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T12:00:00.000Z",
      assets: {
        "example/map@1.0.0/MAP.zip": { count: 5, updated_at: "2026-03-30T12:00:00.000Z", by_source: {} },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_30": {
          total: 5,
          assets: {
            "example/map@1.0.0/MAP.zip": 5,
          },
        },
      },
      timeline: {
        "2026-03-30T03:00:00.000Z": {
          total: 2,
          assets: { "example/map@1.0.0/MAP.zip": 2 },
        },
        "2026-03-30T09:00:00.000Z": {
          total: 3,
          assets: { "example/map@1.0.0/MAP.zip": 3 },
        },
      },
    });
    writeJson(join(repoRoot, "history", "download_attribution_2026_03_30.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T04:00:00.000Z",
      source_ledger_updated_at: "2026-03-30T12:00:00.000Z",
      total_attributed_fetches: 2,
      net_attributed_fetches: 2,
      daily_attributed_fetches: 2,
      assets_daily: {
        "example/map@1.0.0/MAP.zip": 2,
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T23:59:00.000Z",
      maps: {
        downloads: { "map-a": { "1.0.0": 20 } },
        total_downloads: 20,
        net_downloads: 20,
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: { "mod-a": { "1.0.0": 0 } },
        total_downloads: 0,
        net_downloads: 0,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    const result = backfillDownloadHistorySnapshots({ repoRoot });
    assert.deepEqual(result.updatedFiles, ["history/snapshot_2026_03_30.json"]);

    const snapshot = JSON.parse(readFileSync(join(repoRoot, "history", "snapshot_2026_03_30.json"), "utf-8"));
    assert.equal(snapshot.total_downloads, 18);
    assert.equal(snapshot.raw_total_downloads, 20);
    assert.equal(snapshot.total_attributed_downloads, 2);
    assert.equal(snapshot.total_attributed_fetches, 2);
    assert.deepEqual(snapshot.maps.raw_downloads, { "map-a": { "1.0.0": 20 } });
    assert.deepEqual(snapshot.maps.attributed_downloads, { "map-a": { "1.0.0": 2 } });
    assert.deepEqual(snapshot.maps.downloads, { "map-a": { "1.0.0": 18 } });
    assert.equal(snapshot.maps.source_downloads_mode, "legacy_unadjusted");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots uses strict source metadata and skips malformed source entries", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeJson(join(repoRoot, "maps", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-30T00:00:00.000Z",
      listings: {
        "map-a": {
          versions: {
            "1.0.0": {
              is_complete: true,
              source: {
                update_type: "github",
                repo: "example/map",
                tag: "1.0.0",
              },
            },
          },
        },
      },
    });
    writeJson(join(repoRoot, "mods", "integrity.json"), {
      schema_version: 1,
      generated_at: "2026-03-30T00:00:00.000Z",
      listings: {
        "mod-a": {
          versions: {
            "1.0.0": { is_complete: true },
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T12:00:00.000Z",
      assets: {
        "example/map@1.0.0/MAP.zip": { count: 10, updated_at: "2026-03-30T12:00:00.000Z", by_source: {} },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_30": {
          total: 10,
          assets: {
            "example/map@1.0.0/MAP.zip": 10,
          },
        },
      },
      timeline: {},
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 2,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T04:00:00.000Z",
      maps: {
        downloads: { "map-a": { "1.0.0": 10 } },
        raw_downloads: { "map-a": { "1.0.0": 10 } },
        attributed_downloads: { "map-a": { "1.0.0": 0 } },
        total_downloads: 10,
        raw_total_downloads: 10,
        total_attributed_downloads: 0,
        net_downloads: 10,
        source_downloads_mode: "already_adjusted",
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: { "mod-a": { "1.0.0": 0 } },
        raw_downloads: { "mod-a": { "1.0.0": 0 } },
        attributed_downloads: { "mod-a": { "1.0.0": 0 } },
        total_downloads: 0,
        raw_total_downloads: 0,
        total_attributed_downloads: 0,
        net_downloads: 0,
        source_downloads_mode: "already_adjusted",
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    backfillDownloadHistorySnapshots({ repoRoot });

    const snapshot = JSON.parse(readFileSync(join(repoRoot, "history", "snapshot_2026_03_30.json"), "utf-8"));
    assert.deepEqual(snapshot.maps.attributed_downloads, { "map-a": { "1.0.0": 0 } });
    assert.deepEqual(snapshot.maps.downloads, { "map-a": { "1.0.0": 10 } });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots is idempotent after normalization", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrityWithSources(repoRoot);
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {},
      applied_delta_ids: {},
      daily: {},
      timeline: {},
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T12:00:00.000Z",
      maps: {
        downloads: { "map-a": { "1.0.0": 1 } },
        total_downloads: 1,
        net_downloads: 1,
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: { "mod-a": { "1.0.0": 0 } },
        total_downloads: 0,
        net_downloads: 0,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    const first = backfillDownloadHistorySnapshots({ repoRoot });
    const second = backfillDownloadHistorySnapshots({ repoRoot });
    assert.equal(first.updatedFiles.length, 1);
    assert.deepEqual(second.updatedFiles, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
