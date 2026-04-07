/**
 * One-shot script: applies a synthetic download clamp to versions identified
 * as having manifest-version / release-tag mismatches.
 *
 * Formula B (mean valid ratio):
 *   clamped = min(current_adjusted, max(0, floor(rawManifest × MEAN_RATIO) - attribution))
 *
 * Updates:
 *   - mods/downloads.json        (clamped download counts)
 *   - mods/download-version-buckets.json  (bucket ceilings)
 *
 * Usage:
 *   cd scripts && npx tsx apply-version-tag-clamp.ts
 */

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  loadDownloadAttributionLedger,
} from "./lib/download-attribution.js";
import { readJsonFile, writeJsonFile, isObject, sortObjectByKeys } from "./lib/json-utils.js";
import {
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
} from "./lib/download-version-buckets.js";

const repoRoot = resolve(import.meta.dirname, "..");

// Mean ratio of rawMod/rawManifest across 34 valid versions with manifest data
const MEAN_VALID_RATIO = 0.025977;

// ── Parse dry-run TSV for invalid versions ──

const tsvPath = resolve(repoRoot, "tmp", "version-tag-dry-run.tsv");
const tsvLines = readFileSync(tsvPath, "utf-8").trim().split("\n");
// Header: mod_id  version  status  reason  manifest_version  adjusted_downloads  raw_mod_downloads  raw_manifest_downloads
const tsvRows = tsvLines.slice(1).map((line) => line.split("\t"));

interface InvalidVersion {
  modId: string;
  version: string;
  rawManifest: number;
}

const invalidVersions: InvalidVersion[] = [];
for (const row of tsvRows) {
  if (row[2] !== "invalid") continue;
  const rawManifest = parseInt(row[7]!, 10);
  if (!Number.isFinite(rawManifest) || rawManifest <= 0) {
    console.error(`[warn] skipping ${row[0]}@${row[1]}: no rawManifest data`);
    continue;
  }
  invalidVersions.push({ modId: row[0]!, version: row[1]!, rawManifest });
}

console.log(`Found ${invalidVersions.length} invalid versions to clamp\n`);

// ── Load attribution ledger and aggregate by normalized base key ──

const ledger = loadDownloadAttributionLedger(repoRoot);

function getBaseKey(assetKey: string): string {
  const hashIndex = assetKey.indexOf("#");
  return hashIndex >= 0 ? assetKey.slice(0, hashIndex) : assetKey;
}

const attributionByBaseKey: Record<string, number> = {};
for (const [key, entry] of Object.entries(ledger.assets)) {
  const baseKey = getBaseKey(key);
  attributionByBaseKey[baseKey] = (attributionByBaseKey[baseKey] ?? 0) + entry.count;
}

// ── Load integrity cache for asset key reconstruction ──

const cache = JSON.parse(
  readFileSync(resolve(repoRoot, "mods", "integrity-cache.json"), "utf-8"),
) as unknown;

if (!isObject(cache) || !isObject((cache as Record<string, unknown>).entries)) {
  console.error("Could not read integrity-cache.json");
  process.exit(1);
}

const cacheEntries = (cache as { entries: Record<string, Record<string, unknown>> }).entries;

// ── Load downloads and version buckets ──

const downloadsPath = resolve(repoRoot, "mods", "downloads.json");
const downloads = readJsonFile(downloadsPath) as Record<string, Record<string, number>>;
const bucketLedger = loadDownloadVersionBucketLedger(repoRoot, "mod");

// ── Compute and apply clamps ──

const nowIso = new Date().toISOString();
let totalBefore = 0;
let totalAfter = 0;

console.log(
  "mod".padEnd(28) +
  "version".padEnd(12) +
  "current".padStart(10) +
  "clamped".padStart(10) +
  "rawManifest".padStart(13) +
  "attrib".padStart(10),
);
console.log("─".repeat(83));

for (const { modId, version, rawManifest } of invalidVersions) {
  // Reconstruct asset base key from integrity cache source info
  const entry = cacheEntries[modId]?.[version] as
    | { result?: { source?: { repo?: string; tag?: string; asset_name?: string } } }
    | undefined;
  const source = entry?.result?.source;
  if (!source?.repo || !source?.tag || !source?.asset_name) {
    console.error(`[warn] no source info for ${modId}@${version}, skipping`);
    continue;
  }

  const baseKey = `${source.repo.toLowerCase()}@${source.tag}/${source.asset_name.toLowerCase()}`;
  const attribution = attributionByBaseKey[baseKey] ?? 0;
  const currentAdjusted = downloads[modId]?.[version] ?? 0;
  const clamped = Math.min(
    currentAdjusted,
    Math.max(0, Math.floor(rawManifest * MEAN_VALID_RATIO) - attribution),
  );

  totalBefore += currentAdjusted;
  totalAfter += clamped;

  console.log(
    modId.padEnd(28) +
    version.padEnd(12) +
    String(currentAdjusted).padStart(10) +
    String(clamped).padStart(10) +
    String(rawManifest).padStart(13) +
    String(attribution).padStart(10),
  );

  // Update downloads.json
  if (downloads[modId]) {
    downloads[modId]![version] = clamped;
  }

  // Update version buckets — cap all bucket entries for this version
  const listingEntry = bucketLedger.listings[modId];
  if (listingEntry?.versions[version]) {
    const versionEntry = listingEntry.versions[version]!;
    for (const [bucketKey, bucket] of Object.entries(versionEntry.buckets)) {
      versionEntry.buckets[bucketKey] = {
        max_adjusted_downloads: Math.min(bucket.max_adjusted_downloads, clamped),
        last_adjusted_downloads: Math.min(bucket.last_adjusted_downloads, clamped),
        updated_at: nowIso,
      };
    }
    // Recalculate max_total_downloads
    const maxTotal = Object.values(versionEntry.buckets).reduce(
      (max, b) => Math.max(max, b.max_adjusted_downloads),
      0,
    );
    versionEntry.max_total_downloads = maxTotal;
    versionEntry.updated_at = nowIso;
  }
}

console.log("─".repeat(83));
console.log(
  "TOTAL".padEnd(40) +
  String(totalBefore).padStart(10) +
  String(totalAfter).padStart(10),
);
console.log(
  `\nReduction: ${totalBefore} → ${totalAfter} (-${totalBefore - totalAfter}, -${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%)`,
);

// ── Write updated files ──

writeJsonFile(downloadsPath, sortObjectByKeys(downloads));
console.log(`\nUpdated: ${downloadsPath}`);

writeDownloadVersionBucketLedger(repoRoot, "mod", bucketLedger);
console.log(`Updated: mods/download-version-buckets.json`);
