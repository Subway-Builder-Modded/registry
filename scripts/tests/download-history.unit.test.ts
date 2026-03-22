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

function writeIntegrity(
  repoRoot: string,
  listingKind: "maps" | "mods",
  listings: Record<string, Record<string, boolean>>,
): void {
  const outputListings: Record<string, unknown> = {};
  for (const [listingId, versions] of Object.entries(listings)) {
    const versionEntries: Record<string, unknown> = {};
    const completeVersions: string[] = [];
    const incompleteVersions: string[] = [];

    for (const [version, isComplete] of Object.entries(versions)) {
      versionEntries[version] = { is_complete: isComplete };
      if (isComplete) {
        completeVersions.push(version);
      } else {
        incompleteVersions.push(version);
      }
    }

    outputListings[listingId] = {
      has_complete_version: completeVersions.length > 0,
      latest_semver_version: completeVersions.length > 0 ? completeVersions[completeVersions.length - 1] : null,
      latest_semver_complete: completeVersions.length > 0 ? true : null,
      complete_versions: completeVersions,
      incomplete_versions: incompleteVersions,
      versions: versionEntries,
    };
  }

  writeJson(join(repoRoot, listingKind, "integrity.json"), {
    schema_version: 1,
    generated_at: "2026-03-22T00:00:00.000Z",
    listings: outputListings,
  });
}

test("generateDownloadHistorySnapshot filters out versions not marked complete in integrity", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrity(repoRoot, "maps", {
      "map-a": { "1.0.0": true, "1.1.0": true },
      "map-b": {},
    });
    writeIntegrity(repoRoot, "mods", {
      "mod-a": { "2.0.0": true, "2.1.0": false },
    });

    writeJson(join(repoRoot, "maps", "downloads.json"), {
      "map-a": { "1.0.0": 10, "1.1.0": 15 },
      "map-b": {},
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "mod-a": { "2.0.0": 7, "2.1.0": 999 },
    });

    const result = generateDownloadHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-12T00:00:00Z"),
    });

    assert.equal(result.snapshotFile, "history/snapshot_2026_03_12.json");
    assert.equal(result.previousSnapshotFile, null);
    assert.deepEqual(result.snapshot.mods.downloads, { "mod-a": { "2.0.0": 7 } });
    assert.equal(result.snapshot.maps.total_downloads, 25);
    assert.equal(result.snapshot.maps.net_downloads, 25);
    assert.equal(result.snapshot.mods.total_downloads, 7);
    assert.equal(result.snapshot.mods.net_downloads, 7);
    assert.equal(result.snapshot.mods.entries, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /is not complete; skipping version/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateDownloadHistorySnapshot can produce negative net when versions become invalid", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrity(repoRoot, "maps", {
      "map-a": { "1.0.0": true },
      "map-b": {},
    });
    writeIntegrity(repoRoot, "mods", {
      "mod-a": { "2.0.0": false },
    });
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
    assert.deepEqual(result.snapshot.mods.downloads, { "mod-a": {} });
    assert.equal(result.snapshot.mods.total_downloads, 0);
    assert.equal(result.snapshot.mods.net_downloads, -12);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots rewrites snapshots to keep complete versions only", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrity(repoRoot, "maps", {
      "map-a": { "1.0.0": true },
      "map-b": {},
    });
    writeIntegrity(repoRoot, "mods", {
      "mod-a": { "1.0.0": true, "2.0.0": false },
    });
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
          "mod-a": { "1.0.0": 5, "2.0.0": 3 },
        },
        total_downloads: 8,
        net_downloads: 8,
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
          "mod-a": { "1.0.0": 6, "2.0.0": 10 },
        },
        total_downloads: 16,
        net_downloads: 8,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    const result = backfillDownloadHistorySnapshots({ repoRoot });
    assert.equal(result.updatedFiles.length, 2);
    assert.deepEqual(result.updatedFiles, [
      "history/snapshot_2026_03_11.json",
      "history/snapshot_2026_03_12.json",
    ]);

    const first = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_11.json"), "utf-8"),
    ) as Record<string, unknown>;
    const second = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_12.json"), "utf-8"),
    ) as Record<string, unknown>;
    const firstMods = first.mods as Record<string, unknown>;
    const secondMods = second.mods as Record<string, unknown>;
    assert.deepEqual(firstMods.downloads, { "mod-a": { "1.0.0": 5 } });
    assert.equal(firstMods.total_downloads, 5);
    assert.equal(firstMods.net_downloads, 5);
    assert.deepEqual(secondMods.downloads, { "mod-a": { "1.0.0": 6 } });
    assert.equal(secondMods.total_downloads, 6);
    assert.equal(secondMods.net_downloads, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
