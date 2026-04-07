import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { backfillDownloadHistorySnapshots, generateDownloadHistorySnapshot } from "./lib/download-history.js";
import {
  backfillDownloadAttributionHistorySnapshots,
  generateDownloadAttributionHistorySnapshot,
} from "./lib/download-attribution-history.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";
import { isTestListing } from "./lib/test-listings.js";

function toWarningsOutputJson(warnings: string[]): string {
  const MAX_WARNINGS = 30;
  const normalized = warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning !== "")
    .map((warning) => `download-history: ${warning}`);
  const displayed = normalized.slice(0, MAX_WARNINGS);
  if (normalized.length > displayed.length) {
    displayed.push(`...and ${normalized.length - displayed.length} more warnings`);
  }
  return JSON.stringify(displayed);
}

function filterHistoryWarningsForDiscord(repoRoot: string, warnings: string[]): string[] {
  return warnings.filter((warning) => {
    const match = warning.match(/history\/[^:]+:(maps|mods)[^']*listing='([^']+)'/);
    if (!match) return true;
    return !isTestListing(repoRoot, match[1] as "maps" | "mods", match[2]!);
  });
}

function getDateArg(argv: string[]): string | undefined {
  const exact = "--date=";
  for (const arg of argv) {
    if (arg.startsWith(exact)) return arg.slice(exact.length);
  }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date") {
      return argv[index + 1];
    }
  }
  return undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseDateOrThrow(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date value '${value}'. Use ISO format, e.g. 2026-03-12T00:00:00Z`);
  }
  return parsed;
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const isBackfill = hasFlag(argv, "--backfill") || hasFlag(argv, "--backfill-existing");

  if (isBackfill) {
    const result = backfillDownloadHistorySnapshots({ repoRoot });
    const attributionResult = backfillDownloadAttributionHistorySnapshots({ repoRoot });
    for (const warning of result.warnings) {
      console.warn(`[download-history] ${warning}`);
    }
    for (const warning of attributionResult.warnings) {
      console.warn(`[download-history] ${warning}`);
    }
    console.log(
      `[download-history] Backfill complete: updated_download_files=${result.updatedFiles.length}, updated_attribution_files=${attributionResult.updatedFiles.length}`,
    );
    if (result.updatedFiles.length > 0) {
      for (const file of result.updatedFiles) {
        console.log(`[download-history] updated ${file}`);
      }
    }
    if (attributionResult.updatedFiles.length > 0) {
      for (const file of attributionResult.updatedFiles) {
        console.log(`[download-history] updated ${file}`);
      }
    }

    const filteredWarnings = filterHistoryWarningsForDiscord(
      repoRoot,
      [...result.warnings, ...attributionResult.warnings],
    );
    const warningCount = filteredWarnings.length;
    appendGitHubOutput([
      "snapshot_file=",
      "previous_snapshot_file=",
      "attribution_snapshot_file=",
      "attribution_previous_snapshot_file=",
      "maps_total_downloads=",
      "maps_net_downloads=",
      "maps_entries=",
      "mods_total_downloads=",
      "mods_net_downloads=",
      "mods_entries=",
      `warning_count=${warningCount}`,
      `warnings_json=${toWarningsOutputJson(filteredWarnings)}`,
    ]);
    return;
  }

  const forcedNow = parseDateOrThrow(getDateArg(argv));
  const result = generateDownloadHistorySnapshot({
    repoRoot,
    now: forcedNow,
  });
  const attributionResult = generateDownloadAttributionHistorySnapshot({
    repoRoot,
    now: forcedNow,
  });

  for (const warning of result.warnings) {
    console.warn(`[download-history] ${warning}`);
  }
  for (const warning of attributionResult.warnings) {
    console.warn(`[download-history] ${warning}`);
  }

  console.log(
    `[download-history] Snapshot ${result.snapshotFile} (previous=${result.previousSnapshotFile ?? "none"}) mapsTotal=${result.snapshot.maps.total_downloads}, mapsNet=${result.snapshot.maps.net_downloads}, modsTotal=${result.snapshot.mods.total_downloads}, modsNet=${result.snapshot.mods.net_downloads}`,
  );
  console.log(
    `[download-history] Attribution snapshot ${attributionResult.snapshotFile} (previous=${attributionResult.previousSnapshotFile ?? "none"}) total=${attributionResult.snapshot.total_attributed_fetches}, net=${attributionResult.snapshot.net_attributed_fetches}, daily=${attributionResult.snapshot.daily_attributed_fetches}`,
  );

  const filteredWarnings = filterHistoryWarningsForDiscord(
    repoRoot,
    [...result.warnings, ...attributionResult.warnings],
  );
  const warningCount = filteredWarnings.length;
  appendGitHubOutput([
    `snapshot_file=${result.snapshotFile}`,
    `previous_snapshot_file=${result.previousSnapshotFile ?? ""}`,
    `attribution_snapshot_file=${attributionResult.snapshotFile}`,
    `attribution_previous_snapshot_file=${attributionResult.previousSnapshotFile ?? ""}`,
    `attribution_total_fetches=${attributionResult.snapshot.total_attributed_fetches}`,
    `attribution_net_fetches=${attributionResult.snapshot.net_attributed_fetches}`,
    `attribution_daily_fetches=${attributionResult.snapshot.daily_attributed_fetches}`,
    `maps_total_downloads=${result.snapshot.maps.total_downloads}`,
    `maps_net_downloads=${result.snapshot.maps.net_downloads}`,
    `maps_entries=${result.snapshot.maps.entries}`,
    `mods_total_downloads=${result.snapshot.mods.total_downloads}`,
    `mods_net_downloads=${result.snapshot.mods.net_downloads}`,
    `mods_entries=${result.snapshot.mods.entries}`,
    `warning_count=${warningCount}`,
    `warnings_json=${toWarningsOutputJson(filteredWarnings)}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
