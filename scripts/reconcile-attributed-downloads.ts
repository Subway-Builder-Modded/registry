import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { generateDownloadsData } from "./lib/downloads.js";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
} from "./lib/download-attribution.js";
import {
  applyVersionBucketMonotonicCounts,
  loadDownloadVersionBucketLedger,
  writeDownloadVersionBucketLedger,
} from "./lib/download-version-buckets.js";
import {
  loadGrandfatheredDownloads,
  mergeGrandfatheredDownloads,
} from "./lib/grandfathered-downloads.js";
import { generateDownloadHistorySnapshot } from "./lib/download-history.js";
import { appendGitHubOutput, getNonEmptyEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliOptions {
  refreshHistory: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  let refreshHistory = true;
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--no-refresh-history") {
      refreshHistory = false;
      continue;
    }
    if (arg === "--refresh-history") {
      refreshHistory = true;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'. Supported flags: --refresh-history, --no-refresh-history.`);
  }
  return { refreshHistory };
}

function sumDownloads(downloads: Record<string, Record<string, number>>): number {
  let total = 0;
  for (const byVersion of Object.values(downloads)) {
    for (const value of Object.values(byVersion)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
      }
    }
  }
  return total;
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const token = getNonEmptyEnv("GH_DOWNLOADS_TOKEN") ?? getNonEmptyEnv("GITHUB_TOKEN");
  const ledger = loadDownloadAttributionLedger(repoRoot);
  const mapVersionBucketLedger = loadDownloadVersionBucketLedger(repoRoot, "map");
  const modVersionBucketLedger = loadDownloadVersionBucketLedger(repoRoot, "mod");
  const nowIso = new Date().toISOString();

  const mapResult = await generateDownloadsData({
    repoRoot,
    listingType: "map",
    mode: "download-only",
    token,
    attribution: {
      ledger,
      delta: createDownloadAttributionDelta("reconcile:map", undefined, nowIso),
    },
  });
  const modResult = await generateDownloadsData({
    repoRoot,
    listingType: "mod",
    mode: "download-only",
    token,
    attribution: {
      ledger,
      delta: createDownloadAttributionDelta("reconcile:mod", undefined, nowIso),
    },
  });

  const mapsBucketDownloads = applyVersionBucketMonotonicCounts(
    mapVersionBucketLedger,
    mapResult.downloads,
    mapResult.versionBucketInputs,
    nowIso,
  );
  const modsBucketDownloads = applyVersionBucketMonotonicCounts(
    modVersionBucketLedger,
    modResult.downloads,
    modResult.versionBucketInputs,
    nowIso,
  );

  const mapsGrandfathered = loadGrandfatheredDownloads(repoRoot, "map");
  const modsGrandfathered = loadGrandfatheredDownloads(repoRoot, "mod");
  const mapsDownloads = mergeGrandfatheredDownloads(mapsBucketDownloads, mapsGrandfathered);
  const modsDownloads = mergeGrandfatheredDownloads(modsBucketDownloads, modsGrandfathered);

  writeFileSync(resolve(repoRoot, "maps", "downloads.json"), `${JSON.stringify(mapsDownloads, null, 2)}\n`, "utf-8");
  writeFileSync(resolve(repoRoot, "mods", "downloads.json"), `${JSON.stringify(modsDownloads, null, 2)}\n`, "utf-8");
  writeDownloadVersionBucketLedger(repoRoot, "map", mapVersionBucketLedger);
  writeDownloadVersionBucketLedger(repoRoot, "mod", modVersionBucketLedger);

  let snapshotFile = "";
  if (options.refreshHistory) {
    const snapshot = generateDownloadHistorySnapshot({ repoRoot });
    snapshotFile = snapshot.snapshotFile;
    console.log(`[reconcile-attributed-downloads] Refreshed history snapshot: ${snapshot.snapshotFile}`);
  }

  const mapsTotal = sumDownloads(mapsDownloads);
  const modsTotal = sumDownloads(modsDownloads);
  const adjustedDeltaTotal = mapResult.stats.adjusted_delta_total + modResult.stats.adjusted_delta_total;
  const clampedVersions = mapResult.stats.clamped_versions + modResult.stats.clamped_versions;
  console.log(
    `[reconcile-attributed-downloads] done mapsTotal=${mapsTotal} modsTotal=${modsTotal} adjustedDeltaTotal=${adjustedDeltaTotal} clampedVersions=${clampedVersions}`,
  );

  appendGitHubOutput([
    `maps_total=${mapsTotal}`,
    `mods_total=${modsTotal}`,
    `adjusted_delta_total=${adjustedDeltaTotal}`,
    `clamped_versions=${clampedVersions}`,
    `snapshot_file=${snapshotFile}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
