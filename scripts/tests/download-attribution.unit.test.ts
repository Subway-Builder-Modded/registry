import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustDownloadCount,
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
  getAttributedCountForAssetKey,
  getLedgerAssetsForDateCutoff,
  mergeDownloadAttributionDeltas,
  normalizeDownloadAttributionLedger,
  recordDownloadAttributionFetchByUrl,
  sumLedgerDateTotalUpToCutoff,
  sumLedgerTotalUpToCutoff,
  toDownloadAttributionAssetKey,
} from "../lib/download-attribution.js";

test("toDownloadAttributionAssetKey normalizes repo and asset name casing", () => {
  assert.equal(
    toDownloadAttributionAssetKey("Owner/Repo", "v1.2.3", "Map.zip"),
    "owner/repo@v1.2.3/map.zip",
  );
  assert.equal(
    toDownloadAttributionAssetKey("Owner/Repo", "v1.2.3", "Map.zip", "RA_kwDOExample"),
    "owner/repo@v1.2.3/map.zip#RA_kwDOExample",
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

test("adjustDownloadCount caps attribution at raw when attributed exceeds raw", () => {
  const adjusted = adjustDownloadCount(5, 8);
  assert.equal(adjusted.adjusted, 0);
  assert.equal(adjusted.subtracted, 5);
  assert.equal(adjusted.clamped, false);
  assert.equal(adjusted.attributed, 8);
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

test("mergeDownloadAttributionDeltas records timestamp buckets and honors cutoff time queries", () => {
  const ledger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
  const early = createDownloadAttributionDelta("workflow:test", "run-early", "2026-03-30T01:00:00.000Z");
  const late = createDownloadAttributionDelta("workflow:test", "run-late", "2026-03-30T10:00:00.000Z");
  early.assets["owner/repo@v1.0.0/asset.zip"] = 2;
  late.assets["owner/repo@v1.0.0/asset.zip"] = 3;

  const merged = mergeDownloadAttributionDeltas(ledger, [early, late], "2026-03-30T12:00:00.000Z");
  assert.equal(merged.ledger.daily["2026_03_30"]?.total, 5);
  assert.equal(merged.ledger.timeline["2026-03-30T01:00:00.000Z"]?.total, 2);
  assert.equal(merged.ledger.timeline["2026-03-30T10:00:00.000Z"]?.total, 3);

  assert.equal(
    sumLedgerTotalUpToCutoff(merged.ledger, "2026_03_30", "2026-03-30T03:00:00.000Z"),
    2,
  );
  assert.equal(
    sumLedgerDateTotalUpToCutoff(merged.ledger, "2026_03_30", "2026-03-30T03:00:00.000Z"),
    2,
  );
  assert.deepEqual(
    getLedgerAssetsForDateCutoff(merged.ledger, "2026_03_30", "2026-03-30T03:00:00.000Z"),
    { "owner/repo@v1.0.0/asset.zip": 2 },
  );
});

test("getAttributedCountForAssetKey aggregates base-key and identity-key attribution", () => {
  const ledger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
  ledger.assets["owner/repo@v1.0.0/asset.zip"] = {
    count: 3,
    updated_at: "2026-03-30T00:00:00.000Z",
    by_source: {},
  };
  ledger.assets["owner/repo@v1.0.0/asset.zip#RA_abc"] = {
    count: 5,
    updated_at: "2026-03-30T00:00:00.000Z",
    by_source: {},
  };

  const delta = createDownloadAttributionDelta("workflow:test", "delta-identity", "2026-03-30T01:00:00.000Z");
  delta.assets["owner/repo@v1.0.0/asset.zip"] = 2;
  delta.assets["owner/repo@v1.0.0/asset.zip#RA_abc"] = 4;

  assert.equal(
    getAttributedCountForAssetKey(ledger, delta, "owner/repo@v1.0.0/asset.zip#RA_abc"),
    14,
  );
  assert.equal(
    getAttributedCountForAssetKey(ledger, delta, "owner/repo@v1.0.0/asset.zip"),
    14,
  );

  const noIdentityLedger = createEmptyDownloadAttributionLedger("2026-03-30T00:00:00.000Z");
  noIdentityLedger.assets["owner/repo@v1.0.0/asset.zip"] = {
    count: 7,
    updated_at: "2026-03-30T00:00:00.000Z",
    by_source: {},
  };
  assert.equal(
    getAttributedCountForAssetKey(noIdentityLedger, undefined, "owner/repo@v1.0.0/asset.zip#RA_missing"),
    7,
  );
});

test("normalizeDownloadAttributionLedger collapses asset-name case variants", () => {
  const ledger = normalizeDownloadAttributionLedger({
    schema_version: 2,
    updated_at: "2026-03-30T00:00:00.000Z",
    assets: {
      "owner/repo@v1.0.0/Asset.zip": {
        count: 2,
        updated_at: "2026-03-30T00:00:00.000Z",
        by_source: { a: 2 },
      },
      "owner/repo@v1.0.0/asset.zip": {
        count: 3,
        updated_at: "2026-03-30T01:00:00.000Z",
        by_source: { b: 3 },
      },
    },
    applied_delta_ids: {},
    daily: {
      "2026_03_30": {
        total: 5,
        assets: {
          "owner/repo@v1.0.0/Asset.zip": 2,
          "owner/repo@v1.0.0/asset.zip": 3,
        },
      },
    },
    timeline: {},
  });

  assert.equal(ledger.assets["owner/repo@v1.0.0/asset.zip"]?.count, 5);
  assert.equal(ledger.assets["owner/repo@v1.0.0/asset.zip"]?.by_source.a, 2);
  assert.equal(ledger.assets["owner/repo@v1.0.0/asset.zip"]?.by_source.b, 3);
  assert.equal(ledger.daily["2026_03_30"]?.assets["owner/repo@v1.0.0/asset.zip"], 5);
});
