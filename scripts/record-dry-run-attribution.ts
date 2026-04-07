/**
 * One-shot script: records 2 ZIP fetch attributions per complete mod version
 * for the two manual dry-run invocations of dry-run-version-tag-check.ts.
 *
 * Usage:
 *   cd scripts && npx tsx record-dry-run-attribution.ts
 */

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  loadDownloadAttributionLedger,
  writeDownloadAttributionLedger,
  createDownloadAttributionDelta,
  toDownloadAttributionAssetKey,
  mergeDownloadAttributionDeltas,
} from "./lib/download-attribution.js";
import { isObject } from "./lib/json-utils.js";

const repoRoot = resolve(import.meta.dirname, "..");
const DELTA_ID = "manual:dry-run-version-tag-check:2026-04-07";
const SOURCE = "manual:dry-run-version-tag-check";
const FETCHES_PER_VERSION = 2;

const cache = JSON.parse(
  readFileSync(resolve(repoRoot, "mods", "integrity-cache.json"), "utf-8"),
) as unknown;

if (!isObject(cache) || !isObject((cache as Record<string, unknown>).entries)) {
  console.error("Could not read integrity-cache.json");
  process.exit(1);
}

const entries = (cache as { entries: Record<string, Record<string, unknown>> }).entries;
const delta = createDownloadAttributionDelta(SOURCE, DELTA_ID);
let count = 0;

for (const [modId, versions] of Object.entries(entries)) {
  for (const [version, raw] of Object.entries(versions)) {
    if (!isObject(raw)) continue;
    const entry = raw as { result?: { is_complete?: boolean; source?: Record<string, unknown> } };
    if (!entry.result?.is_complete) continue;

    const source = entry.result.source;
    if (!source?.repo || !source?.tag || !source?.asset_name) continue;

    const assetKey = toDownloadAttributionAssetKey(
      source.repo as string,
      source.tag as string,
      source.asset_name as string,
    );

    for (let i = 0; i < FETCHES_PER_VERSION; i++) {
      const current = delta.assets[assetKey] ?? 0;
      delta.assets[assetKey] = current + 1;
    }
    count++;
    console.log(`  ${modId}@${version} → ${assetKey} (+${FETCHES_PER_VERSION})`);
  }
}

console.log(`\nRecorded ${count} versions × ${FETCHES_PER_VERSION} fetches = ${count * FETCHES_PER_VERSION} total attributions`);
console.log(`Delta ID: ${DELTA_ID}`);

const ledger = loadDownloadAttributionLedger(repoRoot);
const result = mergeDownloadAttributionDeltas(ledger, [delta]);

if (result.skippedDeltaIds.length > 0) {
  console.log(`\nDelta already applied (idempotent skip). No changes made.`);
} else {
  writeDownloadAttributionLedger(repoRoot, result.ledger);
  console.log(`\nLedger updated: +${result.addedFetches} fetches applied.`);
}
