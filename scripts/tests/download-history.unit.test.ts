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
    assert.equal(result.snapshot.total_downloads, 32);
    assert.equal(result.snapshot.raw_total_downloads, 32);
    assert.equal(result.snapshot.total_attributed_downloads, 0);
    assert.equal(result.snapshot.total_attributed_fetches, 0);
    assert.equal(result.snapshot.net_downloads, 32);
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
    assert.equal(result.snapshot.total_downloads, 25);
    assert.equal(result.snapshot.raw_total_downloads, 25);
    assert.equal(result.snapshot.total_attributed_downloads, 0);
    assert.equal(result.snapshot.total_attributed_fetches, 0);
    assert.equal(result.snapshot.net_downloads, -7);
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
    assert.equal(first.total_downloads, 25);
    assert.equal(first.raw_total_downloads, 25);
    assert.equal(first.total_attributed_downloads, 0);
    assert.equal(first.total_attributed_fetches, 0);
    assert.equal(first.net_downloads, 25);
    assert.deepEqual(firstMods.downloads, { "mod-a": { "1.0.0": 5 } });
    assert.equal(firstMods.total_downloads, 5);
    assert.equal(firstMods.net_downloads, 5);
    assert.equal(second.total_downloads, 27);
    assert.equal(second.raw_total_downloads, 27);
    assert.equal(second.total_attributed_downloads, 0);
    assert.equal(second.total_attributed_fetches, 0);
    assert.equal(second.net_downloads, 2);
    assert.deepEqual(secondMods.downloads, { "mod-a": { "1.0.0": 6 } });
    assert.equal(secondMods.total_downloads, 6);
    assert.equal(secondMods.net_downloads, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots caps legacy attributed downloads to stored raw counts", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrity(repoRoot, "maps", {
      "map-a": { "1.0.0": true },
      "map-b": {},
    });
    writeIntegrity(repoRoot, "mods", {
      "mod-a": { "1.0.0": true },
    });
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    mkdirSync(join(repoRoot, "maps", "map-a"), { recursive: true });
    mkdirSync(join(repoRoot, "mods", "mod-a"), { recursive: true });

    writeJson(join(repoRoot, "maps", "map-a", "manifest.json"), {
      id: "map-a",
      city_code: "MAPA",
      update: {
        type: "custom",
        url: "https://example.github.io/shared/MAPA.json",
      },
    });
    writeJson(join(repoRoot, "mods", "mod-a", "manifest.json"), {
      id: "mod-a",
      update: {
        type: "github",
        repo: "example/mod-a",
      },
    });

    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 1,
      daily: {
        "2026_03_11": {
          total: 10,
          assets: {
            "example/shared@1.0.0/MAPA.zip": 10,
          },
        },
        "2026_03_12": {
          total: 8,
          assets: {
            "example/mod-a@1.0.0/mod-a.zip": 8,
          },
        },
      },
    });

    writeJson(join(repoRoot, "history", "snapshot_2026_03_12.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_12",
      generated_at: "2026-03-12T00:00:00.000Z",
      maps: {
        downloads: {
          "map-a": { "1.0.0": 4 },
        },
        total_downloads: 4,
        net_downloads: 4,
        index: { schema_version: 1, maps: ["map-a"] },
        entries: 1,
      },
      mods: {
        downloads: {
          "mod-a": { "1.0.0": 3 },
        },
        total_downloads: 3,
        net_downloads: 3,
        index: { schema_version: 1, mods: ["mod-a"] },
        entries: 1,
      },
    });

    const result = backfillDownloadHistorySnapshots({ repoRoot });
    assert.deepEqual(result.updatedFiles, ["history/snapshot_2026_03_12.json"]);
    assert.match(
      result.warnings.join("\n"),
      /attributed downloads exceeded stored raw downloads/,
    );

    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_12.json"), "utf-8"),
    ) as Record<string, unknown>;
    const maps = snapshot.maps as Record<string, unknown>;
    const mods = snapshot.mods as Record<string, unknown>;

    assert.deepEqual(maps.raw_downloads, { "map-a": { "1.0.0": 4 } });
    assert.deepEqual(maps.attributed_downloads, { "map-a": { "1.0.0": 4 } });
    assert.deepEqual(maps.downloads, { "map-a": { "1.0.0": 0 } });
    assert.equal(maps.total_downloads, 0);
    assert.equal(maps.raw_total_downloads, 4);
    assert.equal(maps.total_attributed_downloads, 4);

    assert.deepEqual(mods.raw_downloads, { "mod-a": { "1.0.0": 3 } });
    assert.deepEqual(mods.attributed_downloads, { "mod-a": { "1.0.0": 3 } });
    assert.deepEqual(mods.downloads, { "mod-a": { "1.0.0": 0 } });
    assert.equal(mods.total_downloads, 0);
    assert.equal(mods.raw_total_downloads, 3);
    assert.equal(mods.total_attributed_downloads, 3);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generateDownloadHistorySnapshot filters github map attribution by city code asset token", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    setupBaseRepo(repoRoot);
    writeIntegrity(repoRoot, "maps", {
      "map-a": { "1.0.0": true },
      "map-b": {},
    });
    writeIntegrity(repoRoot, "mods", {
      "mod-a": { "1.0.0": true },
    });
    mkdirSync(join(repoRoot, "maps", "map-a"), { recursive: true });

    writeJson(join(repoRoot, "maps", "downloads.json"), {
      "map-a": { "1.0.0": 5 },
      "map-b": {},
    });
    writeJson(join(repoRoot, "mods", "downloads.json"), {
      "mod-a": { "1.0.0": 0 },
    });
    writeJson(join(repoRoot, "maps", "map-a", "manifest.json"), {
      id: "map-a",
      city_code: "ABC",
      update: {
        type: "github",
        repo: "example/map-pack",
      },
    });
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 1,
      daily: {
        "2026_03_30": {
          total: 10,
          assets: {
            "example/map-pack@1.0.0/ABC.zip": 4,
            "example/map-pack@1.0.0/XYZ.zip": 6,
          },
        },
      },
    });

    const result = generateDownloadHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-30T00:00:00Z"),
    });

    assert.deepEqual(result.snapshot.maps.attributed_downloads, {
      "map-a": { "1.0.0": 4 },
      "map-b": {},
    });
    assert.equal(result.snapshot.maps.total_attributed_downloads, 4);
    assert.equal(result.snapshot.total_attributed_fetches, 10);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots retroactively adjusts legacy snapshots with attribution metadata", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    mkdirSync(join(repoRoot, "maps", "toronto"), { recursive: true });
    mkdirSync(join(repoRoot, "mods"), { recursive: true });

    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["toronto"],
    });
    writeJson(join(repoRoot, "mods", "index.json"), {
      schema_version: 1,
      mods: [],
    });
    writeIntegrity(repoRoot, "maps", {
      toronto: { "1.0.1": true },
    });
    writeIntegrity(repoRoot, "mods", {});

    writeJson(join(repoRoot, "maps", "toronto", "manifest.json"), {
      name: "Toronto",
      author: "devenperez",
      city_code: "YYZ",
      update: {
        type: "custom",
        url: "https://raw.githubusercontent.com/devenperez/subway-builder-canadian-maps/refs/heads/main/railyard/YYZ-update.json",
      },
    });

    mkdirSync(join(repoRoot, "history"), { recursive: true });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "devenperez/subway-builder-canadian-maps@v1.0.1/YYZ.zip": {
          count: 3,
          updated_at: "2026-03-29T00:00:00.000Z",
          by_source: {
            "backfill:regenerate-registry-analytics": 3,
          },
        },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_29": {
          total: 3,
          assets: {
            "devenperez/subway-builder-canadian-maps@v1.0.1/YYZ.zip": 3,
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_29.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_29",
      generated_at: "2026-03-29T00:00:00.000Z",
      maps: {
        downloads: {
          toronto: { "1.0.1": 10 },
        },
        total_downloads: 10,
        net_downloads: 10,
        index: { schema_version: 1, maps: ["toronto"] },
        entries: 1,
      },
      mods: {
        downloads: {},
        total_downloads: 0,
        net_downloads: 0,
        index: { schema_version: 1, mods: [] },
        entries: 0,
      },
    });

    const result = backfillDownloadHistorySnapshots({ repoRoot });
    assert.deepEqual(result.updatedFiles, ["history/snapshot_2026_03_29.json"]);

    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_29.json"), "utf-8"),
    ) as Record<string, unknown>;
    const maps = snapshot.maps as Record<string, unknown>;
    assert.equal(snapshot.schema_version, 2);
    assert.equal(snapshot.total_downloads, 7);
    assert.equal(snapshot.raw_total_downloads, 10);
    assert.equal(snapshot.total_attributed_downloads, 3);
    assert.equal(snapshot.total_attributed_fetches, 3);
    assert.equal(snapshot.net_downloads, 7);
    assert.equal(maps.source_downloads_mode, "legacy_unadjusted");
    assert.deepEqual(maps.downloads, { toronto: { "1.0.1": 7 } });
    assert.deepEqual(maps.raw_downloads, { toronto: { "1.0.1": 10 } });
    assert.deepEqual(maps.attributed_downloads, { toronto: { "1.0.1": 3 } });
    assert.equal(maps.total_downloads, 7);
    assert.equal(maps.raw_total_downloads, 10);
    assert.equal(maps.total_attributed_downloads, 3);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots preserves already adjusted snapshots after rollout", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    mkdirSync(join(repoRoot, "mods", "advanced-analytics"), { recursive: true });
    mkdirSync(join(repoRoot, "maps"), { recursive: true });

    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: [],
    });
    writeJson(join(repoRoot, "mods", "index.json"), {
      schema_version: 1,
      mods: ["advanced-analytics"],
    });
    writeIntegrity(repoRoot, "maps", {});
    writeIntegrity(repoRoot, "mods", {
      "advanced-analytics": { "v1.3.0": true },
    });

    writeJson(join(repoRoot, "mods", "advanced-analytics", "manifest.json"), {
      name: "Advanced Analytics",
      author: "stefanorigano",
      update: {
        type: "github",
        repo: "stefanorigano/advanced_analytics",
      },
    });

    mkdirSync(join(repoRoot, "history"), { recursive: true });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "stefanorigano/advanced_analytics@v1.3.0/advanced_analytics-v1.3.0.zip": {
          count: 2,
          updated_at: "2026-03-30T00:00:00.000Z",
          by_source: {
            "workflow:Regenerate Registry Analytics (Full):mod:full": 2,
          },
        },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_30": {
          total: 2,
          assets: {
            "stefanorigano/advanced_analytics@v1.3.0/advanced_analytics-v1.3.0.zip": 2,
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T00:00:00.000Z",
      maps: {
        downloads: {},
        total_downloads: 0,
        net_downloads: 0,
        index: { schema_version: 1, maps: [] },
        entries: 0,
      },
      mods: {
        downloads: {
          "advanced-analytics": { "v1.3.0": 5 },
        },
        total_downloads: 5,
        net_downloads: 5,
        index: { schema_version: 1, mods: ["advanced-analytics"] },
        entries: 1,
      },
    });

    backfillDownloadHistorySnapshots({ repoRoot });

    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, "history", "snapshot_2026_03_30.json"), "utf-8"),
    ) as Record<string, unknown>;
    const mods = snapshot.mods as Record<string, unknown>;
    assert.equal(snapshot.schema_version, 2);
    assert.equal(snapshot.total_downloads, 5);
    assert.equal(snapshot.raw_total_downloads, 7);
    assert.equal(snapshot.total_attributed_downloads, 2);
    assert.equal(snapshot.total_attributed_fetches, 2);
    assert.equal(snapshot.net_downloads, 5);
    assert.equal(mods.source_downloads_mode, "already_adjusted");
    assert.deepEqual(mods.downloads, { "advanced-analytics": { "v1.3.0": 5 } });
    assert.deepEqual(mods.raw_downloads, { "advanced-analytics": { "v1.3.0": 7 } });
    assert.deepEqual(mods.attributed_downloads, { "advanced-analytics": { "v1.3.0": 2 } });
    assert.equal(mods.total_downloads, 5);
    assert.equal(mods.raw_total_downloads, 7);
    assert.equal(mods.total_attributed_downloads, 2);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadHistorySnapshots is idempotent once snapshots are normalized", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-download-history-"));
  try {
    mkdirSync(join(repoRoot, "maps", "toronto"), { recursive: true });
    mkdirSync(join(repoRoot, "mods"), { recursive: true });

    writeJson(join(repoRoot, "maps", "index.json"), {
      schema_version: 1,
      maps: ["toronto"],
    });
    writeJson(join(repoRoot, "mods", "index.json"), {
      schema_version: 1,
      mods: [],
    });
    writeIntegrity(repoRoot, "maps", {
      toronto: { "1.0.1": true },
    });
    writeIntegrity(repoRoot, "mods", {});
    writeJson(join(repoRoot, "maps", "toronto", "manifest.json"), {
      name: "Toronto",
      author: "devenperez",
      city_code: "YYZ",
      update: {
        type: "custom",
        url: "https://raw.githubusercontent.com/devenperez/subway-builder-canadian-maps/refs/heads/main/railyard/YYZ-update.json",
      },
    });
    mkdirSync(join(repoRoot, "history"), { recursive: true });
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "devenperez/subway-builder-canadian-maps@v1.0.1/YYZ.zip": {
          count: 3,
          updated_at: "2026-03-29T00:00:00.000Z",
          by_source: {
            "backfill:regenerate-registry-analytics": 3,
          },
        },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_29": {
          total: 3,
          assets: {
            "devenperez/subway-builder-canadian-maps@v1.0.1/YYZ.zip": 3,
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_29.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_29",
      generated_at: "2026-03-29T00:00:00.000Z",
      total_downloads: 10,
      raw_total_downloads: 10,
      total_attributed_downloads: 0,
      net_downloads: 10,
      maps: {
        downloads: {
          toronto: { "1.0.1": 10 },
        },
        total_downloads: 10,
        net_downloads: 10,
        index: { schema_version: 1, maps: ["toronto"] },
        entries: 1,
      },
      mods: {
        downloads: {},
        total_downloads: 0,
        net_downloads: 0,
        index: { schema_version: 1, mods: [] },
        entries: 0,
      },
    });

    const first = backfillDownloadHistorySnapshots({ repoRoot });
    const second = backfillDownloadHistorySnapshots({ repoRoot });
    assert.deepEqual(first.updatedFiles, ["history/snapshot_2026_03_29.json"]);
    assert.deepEqual(second.updatedFiles, []);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
