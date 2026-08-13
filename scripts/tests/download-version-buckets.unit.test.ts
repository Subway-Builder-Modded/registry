import test from "node:test";
import assert from "node:assert/strict";
import {
  applyVersionBucketMonotonicCounts,
  createEmptyDownloadVersionBucketLedger,
  toDownloadAssetBucketKey,
} from "../lib/download-version-buckets.js";

test("toDownloadAssetBucketKey appends immutable asset identity when available", () => {
  assert.equal(
    toDownloadAssetBucketKey("Owner/Repo", "v1.0.0", "Map.zip"),
    "owner/repo@v1.0.0/Map.zip",
  );
  assert.equal(
    toDownloadAssetBucketKey("Owner/Repo", "v1.0.0", "Map.zip", "RA_kwDOAssetNode"),
    "owner/repo@v1.0.0/Map.zip#RA_kwDOAssetNode",
  );
});

test("applyVersionBucketMonotonicCounts recovers replaced same-tag assets from prior max", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");

  const first = applyVersionBucketMonotonicCounts(
    ledger,
    {
      sample: {
        "1.0.0": 100,
      },
    },
    {
      sample: {
        "1.0.0": [{
          bucketKey: "owner/repo@1.0.0/sample.zip#assetA",
          adjustedCount: 100,
        }],
      },
    },
    "2026-04-05T00:00:00.000Z",
  );
  assert.equal(first.sample?.["1.0.0"], 100);

  const second = applyVersionBucketMonotonicCounts(
    ledger,
    {
      sample: {
        "1.0.0": 2,
      },
    },
    {
      sample: {
        "1.0.0": [{
          bucketKey: "owner/repo@1.0.0/sample.zip#assetB",
          adjustedCount: 2,
        }],
      },
    },
    "2026-04-05T01:00:00.000Z",
  );

  // downloads.json should recover replacement-resets for the same logical asset.
  assert.equal(second.sample?.["1.0.0"], 100);
  // Ledger still preserves monotonic historical max for audit/debug.
  assert.equal(ledger.listings.sample?.versions["1.0.0"]?.max_total_downloads, 100);
});

test("applyVersionBucketMonotonicCounts keeps single-bucket versions on current adjusted value", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");

  const first = applyVersionBucketMonotonicCounts(
    ledger,
    {
      sample: {
        "1.0.0": 100,
      },
    },
    {
      sample: {
        "1.0.0": [{
          bucketKey: "owner/repo@1.0.0/sample.zip#assetA",
          adjustedCount: 100,
        }],
      },
    },
    "2026-04-05T00:00:00.000Z",
  );
  assert.equal(first.sample?.["1.0.0"], 100);

  const second = applyVersionBucketMonotonicCounts(
    ledger,
    {
      sample: {
        "1.0.0": 2,
      },
    },
    {
      sample: {
        "1.0.0": [{
          bucketKey: "owner/repo@1.0.0/sample.zip#assetA",
          adjustedCount: 2,
        }],
      },
    },
    "2026-04-05T01:00:00.000Z",
  );

  assert.equal(second.sample?.["1.0.0"], 2);
  assert.equal(ledger.listings.sample?.versions["1.0.0"]?.max_total_downloads, 100);
});

test("applyVersionBucketMonotonicCounts uses history-max floor when canonical bucket drops", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");
  ledger.listings.sample = {
    versions: {
      "1.0.0": {
        max_total_downloads: 164,
        buckets: {
          "history-max:sample:1.0.0": {
            max_adjusted_downloads: 164,
            last_adjusted_downloads: 164,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
          "owner/repo@1.0.0/sample.zip#assetB": {
            max_adjusted_downloads: 0,
            last_adjusted_downloads: 0,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    },
  };

  const next = applyVersionBucketMonotonicCounts(
    ledger,
    { sample: { "1.0.0": 0 } },
    { sample: { "1.0.0": [{ bucketKey: "owner/repo@1.0.0/sample.zip#assetB", adjustedCount: 0 }] } },
    "2026-04-05T01:00:00.000Z",
  );

  assert.equal(next.sample?.["1.0.0"], 164);
});

test("applyVersionBucketMonotonicCounts drops synthetic legacy buckets when canonical buckets exist", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");
  ledger.listings.sample = {
    versions: {
      "1.0.0": {
        max_total_downloads: 100,
        buckets: {
          "legacy:sample:1.0.0": {
            max_adjusted_downloads: 80,
            last_adjusted_downloads: 80,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
          "owner/repo@1.0.0/sample.zip#assetA": {
            max_adjusted_downloads: 20,
            last_adjusted_downloads: 20,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    },
  };

  const next = applyVersionBucketMonotonicCounts(
    ledger,
    { sample: { "1.0.0": 25 } },
    { sample: { "1.0.0": [{ bucketKey: "owner/repo@1.0.0/sample.zip#assetA", adjustedCount: 25 }] } },
    "2026-04-05T01:00:00.000Z",
  );

  assert.equal(next.sample?.["1.0.0"], 25);
  assert.deepEqual(
    Object.keys(ledger.listings.sample?.versions["1.0.0"]?.buckets ?? {}),
    ["owner/repo@1.0.0/sample.zip#assetA"],
  );
});

test("applyVersionBucketMonotonicCounts freezes ledger versions whose releases were deleted", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");
  ledger.listings.sample = {
    versions: {
      "0.1.0": {
        max_total_downloads: 17,
        buckets: {
          "owner/pack@0.4.11/AXT.zip#assetA": {
            max_adjusted_downloads: 17,
            last_adjusted_downloads: 17,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
      "0.0.1": {
        max_total_downloads: 0,
        buckets: {
          "owner/pack@0.4.01/AXT.zip#assetZ": {
            max_adjusted_downloads: 0,
            last_adjusted_downloads: 0,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    },
  };

  // The upstream release/asset for 0.1.0 was deleted, so the pipeline only
  // produced the still-live 0.2.0. 0.1.0 keeps its final value; the
  // zero-count 0.0.1 is not emitted.
  const next = applyVersionBucketMonotonicCounts(
    ledger,
    { sample: { "0.2.0": 3 } },
    { sample: { "0.2.0": [{ bucketKey: "owner/pack@0.4.12/AXT.zip#assetB", adjustedCount: 3 }] } },
    "2026-04-05T01:00:00.000Z",
  );

  assert.deepEqual(next.sample, { "0.1.0": 17, "0.2.0": 3 });
  // The retired version's ledger entry is carried through untouched.
  assert.equal(ledger.listings.sample?.versions["0.1.0"]?.max_total_downloads, 17);
});

test("applyVersionBucketMonotonicCounts freeze respects repaired (lowered) final values", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");
  ledger.listings.sample = {
    versions: {
      "1.0.0": {
        max_total_downloads: 500,
        buckets: {
          "owner/repo@1.0.0/sample.zip#assetA": {
            max_adjusted_downloads: 500,
            last_adjusted_downloads: 120,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    },
  };

  // Single canonical bucket: the frozen value is the last observed (possibly
  // repaired-down) count, not the historical max.
  const next = applyVersionBucketMonotonicCounts(
    ledger,
    { sample: {} },
    {},
    "2026-04-05T01:00:00.000Z",
  );

  assert.deepEqual(next.sample, { "1.0.0": 120 });
});

test("applyVersionBucketMonotonicCounts does not resurrect listings absent from pipeline output", () => {
  const ledger = createEmptyDownloadVersionBucketLedger("2026-04-05T00:00:00.000Z");
  ledger.listings.deprecated = {
    versions: {
      "1.0.0": {
        max_total_downloads: 42,
        buckets: {
          "owner/repo@1.0.0/sample.zip#assetA": {
            max_adjusted_downloads: 42,
            last_adjusted_downloads: 42,
            updated_at: "2026-04-05T00:00:00.000Z",
          },
        },
        updated_at: "2026-04-05T00:00:00.000Z",
      },
    },
  };

  // Deprecated/deleted listings are removed from pipeline output entirely
  // (overlay); the freeze only applies to listings the pipeline still emits.
  const next = applyVersionBucketMonotonicCounts(
    ledger,
    { other: { "1.0.0": 5 } },
    { other: { "1.0.0": [{ bucketKey: "owner/other@1.0.0/o.zip#assetB", adjustedCount: 5 }] } },
    "2026-04-05T01:00:00.000Z",
  );

  assert.equal(next.deprecated, undefined);
});
