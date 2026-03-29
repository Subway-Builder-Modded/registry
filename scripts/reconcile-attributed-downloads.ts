import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync, writeFileSync } from "node:fs";
import { generateDownloadsData } from "./lib/downloads.js";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
} from "./lib/download-attribution.js";
import { generateDownloadHistorySnapshot } from "./lib/download-history.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

interface CliOptions {
  refreshHistory: boolean;
}

function getNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
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
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const token = getNonEmptyEnv("GH_DOWNLOADS_TOKEN") ?? getNonEmptyEnv("GITHUB_TOKEN");
  const ledger = loadDownloadAttributionLedger(repoRoot);
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

  writeFileSync(resolve(repoRoot, "maps", "downloads.json"), `${JSON.stringify(mapResult.downloads, null, 2)}\n`, "utf-8");
  writeFileSync(resolve(repoRoot, "mods", "downloads.json"), `${JSON.stringify(modResult.downloads, null, 2)}\n`, "utf-8");

  let snapshotFile = "";
  if (options.refreshHistory) {
    const snapshot = generateDownloadHistorySnapshot({ repoRoot });
    snapshotFile = snapshot.snapshotFile;
    console.log(`[reconcile-attributed-downloads] Refreshed history snapshot: ${snapshot.snapshotFile}`);
  }

  const mapsTotal = sumDownloads(mapResult.downloads);
  const modsTotal = sumDownloads(modResult.downloads);
  const adjustedDeltaTotal = mapResult.stats.adjusted_delta_total + modResult.stats.adjusted_delta_total;
  const clampedVersions = mapResult.stats.clamped_versions + modResult.stats.clamped_versions;
  console.log(
    `[reconcile-attributed-downloads] done mapsTotal=${mapsTotal} modsTotal=${modsTotal} adjustedDeltaTotal=${adjustedDeltaTotal} clampedVersions=${clampedVersions}`,
  );

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `maps_total=${mapsTotal}`,
      `mods_total=${modsTotal}`,
      `adjusted_delta_total=${adjustedDeltaTotal}`,
      `clamped_versions=${clampedVersions}`,
      `snapshot_file=${snapshotFile}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
