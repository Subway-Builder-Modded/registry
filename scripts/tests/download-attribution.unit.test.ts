import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustDownloadCount,
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  recordDownloadAttributionFetchByUrl,
  toDownloadAttributionAssetKey,
} from "../lib/download-attribution.js";

test("toDownloadAttributionAssetKey normalizes repo and preserves tag/asset", () => {
  assert.equal(
    toDownloadAttributionAssetKey("Owner/Repo", "v1.2.3", "Map.zip"),
    "owner/repo@v1.2.3/Map.zip",
  );
});

test("recordDownloadAttributionFetchByUrl tracks github release asset fetches", () => {
  const delta = createDownloadAttributionDelta("test-source", "delta-1", "2026-03-30T00:00:00.000Z");
  const recorded = recordDownloadAttributionFetchByUrl(
    delta,
    "https://github.com/Owner/Repo/releases/download/v1.0.0/asset.zip",
  );
  assert.equal(recorded.ok, true);
  assert.equal(delta.assets["owner/repo@v1.0.0/asset.zip"], 1);

  const rejected = recordDownloadAttributionFetchByUrl(
    delta,
    "https://example.com/not-a-release.zip",
  );
  assert.equal(rejected.ok, false);
  assert.equal(delta.assets["owner/repo@v1.0.0/asset.zip"], 1);
});

test("adjustDownloadCount clamps to zero when attributed exceeds raw", () => {
  const adjusted = adjustDownloadCount(5, 8);
  assert.equal(adjusted.adjusted, 0);
  assert.equal(adjusted.subtracted, 5);
  assert.equal(adjusted.clamped, true);
});

test("mergeDownloadAttributionDeltas applies once per delta_id", () => {
  const ledger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
  const delta = createDownloadAttributionDelta("workflow:test", "run-123", "2026-03-30T01:00:00.000Z");
  delta.assets["owner/repo@v1.0.0/asset.zip"] = 2;

  const first = mergeDownloadAttributionDeltas(ledger, [delta], "2026-03-30T02:00:00.000Z");
  assert.equal(first.addedFetches, 2);
  assert.equal(first.ledger.assets["owner/repo@v1.0.0/asset.zip"]?.count, 2);
  assert.equal(first.appliedDeltaIds.length, 1);

  const second = mergeDownloadAttributionDeltas(first.ledger, [delta], "2026-03-30T03:00:00.000Z");
  assert.equal(second.addedFetches, 0);
  assert.equal(second.ledger.assets["owner/repo@v1.0.0/asset.zip"]?.count, 2);
  assert.equal(second.appliedDeltaIds.length, 0);
  assert.equal(second.skippedDeltaIds.length, 1);
});
