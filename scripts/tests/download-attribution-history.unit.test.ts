import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateDownloadAttributionHistorySnapshot,
  backfillDownloadAttributionHistorySnapshots,
} from "../lib/download-attribution-history.js";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

test("generateDownloadAttributionHistorySnapshot writes daily attribution snapshot", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-attr-history-test-"));
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  try {
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "owner/repo@v1.0.0/a.zip": {
          count: 5,
          updated_at: "2026-03-30T00:00:00.000Z",
          by_source: { test: 5 },
        },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_30": {
          total: 2,
          assets: {
            "owner/repo@v1.0.0/a.zip": 2,
          },
        },
      },
    });

    const result = generateDownloadAttributionHistorySnapshot({
      repoRoot,
      now: new Date("2026-03-30T01:00:00.000Z"),
    });
    assert.equal(result.snapshot.snapshot_date, "2026_03_30");
    assert.equal(result.snapshot.total_attributed_fetches, 2);
    assert.equal(result.snapshot.net_attributed_fetches, 2);
    assert.equal(result.snapshot.daily_attributed_fetches, 2);
    assert.equal(result.snapshot.assets_daily["owner/repo@v1.0.0/a.zip"], 2);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("backfillDownloadAttributionHistorySnapshots writes files for existing snapshot dates", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-attr-history-backfill-test-"));
  mkdirSync(join(repoRoot, "history"), { recursive: true });
  try {
    writeJson(join(repoRoot, "history", "registry-download-attribution.json"), {
      schema_version: 2,
      updated_at: "2026-03-30T00:00:00.000Z",
      assets: {
        "owner/repo@v1.0.0/a.zip": {
          count: 3,
          updated_at: "2026-03-30T00:00:00.000Z",
          by_source: { test: 3 },
        },
      },
      applied_delta_ids: {},
      daily: {
        "2026_03_29": {
          total: 1,
          assets: {
            "owner/repo@v1.0.0/a.zip": 1,
          },
        },
        "2026_03_30": {
          total: 2,
          assets: {
            "owner/repo@v1.0.0/a.zip": 2,
          },
        },
      },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_29.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_29",
      generated_at: "2026-03-29T00:00:00.000Z",
      maps: { downloads: {}, total_downloads: 0, net_downloads: 0, index: { schema_version: 1, maps: [] }, entries: 0 },
      mods: { downloads: {}, total_downloads: 0, net_downloads: 0, index: { schema_version: 1, mods: [] }, entries: 0 },
    });
    writeJson(join(repoRoot, "history", "snapshot_2026_03_30.json"), {
      schema_version: 1,
      snapshot_date: "2026_03_30",
      generated_at: "2026-03-30T00:00:00.000Z",
      maps: { downloads: {}, total_downloads: 0, net_downloads: 0, index: { schema_version: 1, maps: [] }, entries: 0 },
      mods: { downloads: {}, total_downloads: 0, net_downloads: 0, index: { schema_version: 1, mods: [] }, entries: 0 },
    });

    const result = backfillDownloadAttributionHistorySnapshots({ repoRoot });
    assert.equal(result.updatedFiles.length, 2);

    const day1 = JSON.parse(readFileSync(join(repoRoot, "history", "download_attribution_2026_03_29.json"), "utf-8"));
    const day2 = JSON.parse(readFileSync(join(repoRoot, "history", "download_attribution_2026_03_30.json"), "utf-8"));
    assert.equal(day1.daily_attributed_fetches, 1);
    assert.equal(day2.daily_attributed_fetches, 2);
    assert.equal(day1.total_attributed_fetches, 1);
    assert.equal(day2.total_attributed_fetches, 3);
    assert.equal(day1.net_attributed_fetches, 1);
    assert.equal(day2.net_attributed_fetches, 2);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
