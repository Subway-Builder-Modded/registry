import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// One-shot correction for the charleston-huntington-wv faulty-client inflation
// (see KNOWN_INCIDENTS.md, 2026-07-28 entry). The re-uploaded CHA.zip asset was
// re-downloaded by an automated client at ~8-10/day from mid-April through June
// 2026; the peer-scaled organic estimate is 65 of the 800 raw downloads.
//
// This script re-interpolates the listing's value across history/snapshot_*.json
// so the recorded trajectory reflects the organic estimate: linear from 5
// (the 2026-04-11 freeze value) to 65 (2026-07-28), never exceeding what was
// originally recorded. Without this, an ops rebuild of the version buckets from
// history (rebuild-download-version-buckets.ts) would resurrect the inflated
// count as a history-max floor.
//
// Companion corrections in the same change: +735 manual attribution
// (history/manual-attribution-specs/2026_07_28_charleston_huntington_faulty_client.json),
// bucket max lowered to 65, downloads.json set to 65.

const LISTING_ID = "charleston-huntington-wv";
const VERSION = "1.0.0";
const FREEZE_MS = Date.parse("2026-04-11");
const CORRECTION_MS = Date.parse("2026-07-28");
const FREEZE_VALUE = 5;
const CORRECTED_VALUE = 65;

interface SnapshotFile {
  total_downloads?: number;
  maps?: { downloads?: Record<string, Record<string, number>> };
}

function run(): void {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const historyDir = resolve(repoRoot, "history");
  const files = readdirSync(historyDir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .sort();

  let changed = 0;
  for (const name of files) {
    const path = resolve(historyDir, name);
    const snapshot = JSON.parse(readFileSync(path, "utf-8")) as SnapshotFile;
    const entry = snapshot.maps?.downloads?.[LISTING_ID];
    const original = entry?.[VERSION];
    if (!entry || typeof original !== "number") continue;

    const snapshotMs = Date.parse(name.slice(9, 19).replaceAll("_", "-"));
    if (!Number.isFinite(snapshotMs) || snapshotMs <= FREEZE_MS) continue;

    const organic = snapshotMs >= CORRECTION_MS
      ? CORRECTED_VALUE
      : FREEZE_VALUE
        + Math.round((CORRECTED_VALUE - FREEZE_VALUE) * (snapshotMs - FREEZE_MS) / (CORRECTION_MS - FREEZE_MS));
    const corrected = Math.min(original, organic);
    if (corrected === original) continue;

    entry[VERSION] = corrected;
    if (typeof snapshot.total_downloads === "number") {
      snapshot.total_downloads -= original - corrected;
    }
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
    changed += 1;
  }

  console.log(`[charleston-snapshot-clamp] corrected ${changed} of ${files.length} snapshots`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(() => run());
}
