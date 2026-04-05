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

test("applyVersionBucketMonotonicCounts keeps version totals non-decreasing across asset replacement", () => {
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

  // Previous bucket max (100) is retained even though the new asset starts at 2.
  assert.equal(second.sample?.["1.0.0"], 102);
});

