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
  writeJson(join(repoRoot, "maps", "index.json"), {
    schema_version: 1,
    maps: ["map-a", "map-b"],
  });
  writeJson(join(repoRoot, "mods", "index.json"), {
    schema_version: 1,
    mods: ["mod-a"],
  });
}

test("generateDownloadHistorySnapshot writes first snapshot with net equal to totals", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeJson(join(repoRoot, "maps", "downloads.json"), {
      "map-a": { "1.0.0": 10, "1.1.0": 15 },
      "map-b": {},
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "mod-a": { "2.0.0": 7 },
    });

    const result = generateDownloadHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-12T00:00:00Z"),
    });

    assert.equal(result.snapshotFile, "history/snapshot_2026_03_12.json");
    assert.equal(result.previousSnapshotFile, null);
    assert.equal(result.snapshot.maps.total_downloads, 25);
    assert.equal(result.snapshot.maps.net_downloads, 25);
    assert.equal(result.snapshot.maps.entries, 2);
    assert.equal(result.snapshot.mods.total_downloads, 7);
    assert.equal(result.snapshot.mods.net_downloads, 7);
    assert.equal(result.snapshot.mods.entries, 1);
    assert.deepEqual(result.warnings, []);

    const written = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_12.json"), "utf-8"),
    );
    assert.equal(written.maps.total_downloads, 25);
    assert.equal(written.mods.total_downloads, 7);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateDownloadHistorySnapshot carries forward removed versions and computes non-negative net", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_11.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_11",
      generated_at: "2026-03-11T00:00:00.000Z",
      maps: {
        downloads: {},
        total_downloads: 20,
        net_downloads: 20,
        index: { schema_version: 1, maps: [] },
        entries: 0,
      },
      mods: {
        downloads: { "mod-a": { "2.0.0": 12 } },
        total_downloads: 12,
        net_downloads: 12,
        index: { schema_version: 1, mods: [] },
        entries: 0,
      },
    });
    writeJson(join(repoRoot, "maps", "downloads.json"), {
      "map-a": { "1.0.0": 25 },
      "map-b": {},
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "mod-a": { "2.0.0": 10 },
    });

    const result = generateDownloadHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-12T00:00:00Z"),
    });

    assert.equal(result.previousSnapshotFile, "history/snapshot_2026_03_11.json");
    assert.equal(result.snapshot.maps.total_downloads, 25);
    assert.equal(result.snapshot.maps.net_downloads, 5);
    assert.deepEqual(result.snapshot.mods.downloads, { "mod-a": { "2.0.0": 12 } });
    assert.equal(result.snapshot.mods.total_downloads, 12);
    assert.equal(result.snapshot.mods.net_downloads, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots rewrites past snapshots to preserve removed versions", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    mkdirSync(join(repoRoot, "history"), { recursive: true });

    writeJson(join(repoRoot, "history", "snapshot_2026_03_11.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_11",
      generated_at: "2026-03-11T00:00:00.000Z",
      maps: {
        downloads: {
          "map-a": { "1.0.0": 20 },
        },
        total_downloads: 20,
        net_downloads: 20,
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: {
          "mod-a": { "1.0.0": 5 },
        },
        total_downloads: 5,
        net_downloads: 5,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    writeJson(join(repoRoot, "history", "snapshot_2026_03_12.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_12",
      generated_at: "2026-03-12T00:00:00.000Z",
      maps: {
        downloads: {
          "map-a": { "1.0.0": 21 },
        },
        total_downloads: 21,
        net_downloads: 1,
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: {
          "mod-a": {},
        },
        total_downloads: 0,
        net_downloads: -5,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    const result = backfillDownloadHistorySnapshots({ repoRoot });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.updatedFiles, ["history/snapshot_2026_03_12.json"]);

    const second = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_12.json"), "utf-8"),
    ) as Record<string, unknown>;
    const mods = second.mods as Record<string, unknown>;
    assert.deepEqual(mods.downloads, { "mod-a": { "1.0.0": 5 } });
    assert.equal(mods.total_downloads, 5);
    assert.equal(mods.net_downloads, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
