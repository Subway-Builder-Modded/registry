import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRailyardAppAnalytics,
  buildRailyardAppAnalyticsCsvRows,
  buildRailyardAppHistorySnapshot,
  compareSemverDescending,
  createEmptyRailyardAppDownloadHistory,
  normalizeStableSemverTag,
  toHourBucketIso,
  upsertRailyardAppHistorySnapshot,
} from "../lib/railyard-app-downloads.js";

test("buildRailyardAppHistorySnapshot includes only stable semver releases", () => {
  const snapshot = buildRailyardAppHistorySnapshot([
    {
      tag_name: "v1.2.3",
      assets: [
        { name: "mac.dmg", download_count: 10 },
        { name: "win.exe", download_count: 20 },
      ],
    },
    {
      tag_name: "v1.2.4-rc1",
      assets: [{ name: "rc.dmg", download_count: 99 }],
    },
    {
      tag_name: "nightly",
      assets: [{ name: "nightly.dmg", download_count: 50 }],
    },
    {
      tag_name: "2.0.0",
      prerelease: true,
      assets: [{ name: "release.dmg", download_count: 100 }],
    },
  ], "2026-03-30T15:00:00.000Z");

  assert.deepEqual(snapshot.versions, {
    "1.2.3": {
      total_downloads: 30,
      assets: {
        "mac.dmg": 10,
        "win.exe": 20,
      },
    },
  });
});

test("upsertRailyardAppHistorySnapshot is idempotent within the same hour bucket", () => {
  const history = createEmptyRailyardAppDownloadHistory("Subway-Builder-Modded/railyard", "2026-03-30T15:00:00.000Z");
  const bucket = toHourBucketIso(new Date("2026-03-30T15:27:10.000Z"));

  const first = upsertRailyardAppHistorySnapshot({
    history,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.0.0",
        assets: [{ name: "Railyard.dmg", download_count: 5 }],
      },
    ], bucket),
    snapshotKey: bucket,
    updatedAt: "2026-03-30T15:27:10.000Z",
  });

  const second = upsertRailyardAppHistorySnapshot({
    history: first,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.0.0",
        assets: [{ name: "Railyard.dmg", download_count: 7 }],
      },
    ], bucket),
    snapshotKey: bucket,
    updatedAt: "2026-03-30T15:40:00.000Z",
  });

  assert.equal(Object.keys(second.snapshots).length, 1);
  assert.equal(second.snapshots[bucket]?.versions["1.0.0"]?.total_downloads, 7);
});

test("buildRailyardAppAnalytics computes version and asset windows and CSV rows", () => {
  let history = createEmptyRailyardAppDownloadHistory("Subway-Builder-Modded/railyard", "2026-03-20T00:00:00.000Z");

  history = upsertRailyardAppHistorySnapshot({
    history,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.0.0",
        assets: [
          { name: "mac.dmg", download_count: 100 },
          { name: "win.exe", download_count: 200 },
        ],
      },
      {
        tag_name: "1.1.0",
        assets: [
          { name: "mac.dmg", download_count: 10 },
          { name: "win.exe", download_count: 20 },
        ],
      },
    ], "2026-03-23T15:00:00.000Z"),
    snapshotKey: "2026-03-23T15:00:00.000Z",
  });

  history = upsertRailyardAppHistorySnapshot({
    history,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.0.0",
        assets: [
          { name: "mac.dmg", download_count: 125 },
          { name: "win.exe", download_count: 240 },
        ],
      },
      {
        tag_name: "1.1.0",
        assets: [
          { name: "mac.dmg", download_count: 60 },
          { name: "win.exe", download_count: 90 },
        ],
      },
    ], "2026-03-29T15:00:00.000Z"),
    snapshotKey: "2026-03-29T15:00:00.000Z",
  });

  history = upsertRailyardAppHistorySnapshot({
    history,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.0.0",
        assets: [
          { name: "mac.dmg", download_count: 130 },
          { name: "win.exe", download_count: 250 },
        ],
      },
      {
        tag_name: "1.1.0",
        assets: [
          { name: "mac.dmg", download_count: 75 },
          { name: "win.exe", download_count: 105 },
        ],
      },
    ], "2026-03-30T15:00:00.000Z"),
    snapshotKey: "2026-03-30T15:00:00.000Z",
  });

  const analytics = buildRailyardAppAnalytics(history, "2026-03-30T15:10:00.000Z");
  assert.equal(analytics.latest_snapshot, "2026-03-30T15:00:00.000Z");
  assert.deepEqual(analytics.versions["1.1.0"], {
    total_downloads: 180,
    last_1d_downloads: 30,
    last_3d_downloads: 150,
    last_7d_downloads: 150,
    assets: {
      "mac.dmg": {
        total_downloads: 75,
        last_1d_downloads: 15,
        last_3d_downloads: 65,
        last_7d_downloads: 65,
      },
      "win.exe": {
        total_downloads: 105,
        last_1d_downloads: 15,
        last_3d_downloads: 85,
        last_7d_downloads: 85,
      },
    },
  });

  const rows = buildRailyardAppAnalyticsCsvRows(analytics);
  assert.deepEqual(rows[0], {
    version: "1.1.0",
    total_downloads: 180,
    last_1d_downloads: 30,
    last_3d_downloads: 150,
    last_7d_downloads: 150,
    "mac.dmg_total_downloads": 75,
    "mac.dmg_last_1d_downloads": 15,
    "mac.dmg_last_3d_downloads": 65,
    "mac.dmg_last_7d_downloads": 65,
    "win.exe_total_downloads": 105,
    "win.exe_last_1d_downloads": 15,
    "win.exe_last_3d_downloads": 85,
    "win.exe_last_7d_downloads": 85,
  });
});

test("buildRailyardAppAnalytics leaves missing windows unknown instead of zero", () => {
  let history = createEmptyRailyardAppDownloadHistory("Subway-Builder-Modded/railyard", "2026-03-30T00:00:00.000Z");

  history = upsertRailyardAppHistorySnapshot({
    history,
    snapshot: buildRailyardAppHistorySnapshot([
      {
        tag_name: "1.2.3",
        assets: [
          { name: "mac.dmg", download_count: 12 },
          { name: "win.exe", download_count: 34 },
        ],
      },
    ], "2026-03-30T15:00:00.000Z"),
    snapshotKey: "2026-03-30T15:00:00.000Z",
  });

  const analytics = buildRailyardAppAnalytics(history, "2026-03-30T15:10:00.000Z");
  assert.deepEqual(analytics.versions["1.2.3"], {
    total_downloads: 46,
    last_1d_downloads: null,
    last_3d_downloads: null,
    last_7d_downloads: null,
    assets: {
      "mac.dmg": {
        total_downloads: 12,
        last_1d_downloads: null,
        last_3d_downloads: null,
        last_7d_downloads: null,
      },
      "win.exe": {
        total_downloads: 34,
        last_1d_downloads: null,
        last_3d_downloads: null,
        last_7d_downloads: null,
      },
    },
  });

  const rows = buildRailyardAppAnalyticsCsvRows(analytics);
  assert.deepEqual(rows[0], {
    version: "1.2.3",
    total_downloads: 46,
    last_1d_downloads: "",
    last_3d_downloads: "",
    last_7d_downloads: "",
    "mac.dmg_total_downloads": 12,
    "mac.dmg_last_1d_downloads": "",
    "mac.dmg_last_3d_downloads": "",
    "mac.dmg_last_7d_downloads": "",
    "win.exe_total_downloads": 34,
    "win.exe_last_1d_downloads": "",
    "win.exe_last_3d_downloads": "",
    "win.exe_last_7d_downloads": "",
  });
});

test("semver helpers normalize and sort descending", () => {
  assert.equal(normalizeStableSemverTag("v1.2.3"), "1.2.3");
  assert.equal(normalizeStableSemverTag("1.2.3"), "1.2.3");
  assert.equal(normalizeStableSemverTag("1.2.3-rc1"), null);
  assert.deepEqual(["1.0.0", "1.10.0", "2.0.0"].sort(compareSemverDescending), ["2.0.0", "1.10.0", "1.0.0"]);
});
