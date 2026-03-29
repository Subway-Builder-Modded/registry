import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync } from "node:fs";
import { backfillDownloadHistorySnapshots, generateDownloadHistorySnapshot } from "./lib/download-history.js";
import {
  backfillDownloadAttributionHistorySnapshots,
  generateDownloadAttributionHistorySnapshot,
} from "./lib/download-attribution-history.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

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
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
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

    if (process.env.GITHUB_OUTPUT) {
      const warningCount = result.warnings.length + attributionResult.warnings.length;
      const outputLines = [
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
        `warnings_json=${toWarningsOutputJson([...result.warnings, ...attributionResult.warnings])}`,
      ];
      appendFileSync(process.env.GITHUB_OUTPUT, `${outputLines.join("\n")}\n`);
    }
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

  if (process.env.GITHUB_OUTPUT) {
    const warningCount = result.warnings.length + attributionResult.warnings.length;
    const outputLines = [
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
      `warnings_json=${toWarningsOutputJson([...result.warnings, ...attributionResult.warnings])}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputLines.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
