import { pathToFileURL } from "node:url";
import {
  createEmptyWebsiteAnalyticsHistory,
  loadWebsiteAnalyticsHistory,
  writeWebsiteAnalyticsHistory,
  upsertHourlySnapshot,
  updateValidPaths,
  toHourBucketIso,
  toDateKey,
  mergeSortedUniqueStrings,
  type WebsiteAnalyticsSnapshot,
} from "../lib/website-analytics.js";
import {
  captureWindowSnapshot,
  requireCloudflareCredentials,
  type CloudflareCredentials,
} from "../lib/website-analytics-capture.js";
import { loadLocalDotEnv, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

interface CliArgs extends CloudflareCredentials {
  repoRoot: string;
  days: number;
  resetHistory: boolean;
}

const DEFAULT_BACKFILL_DAYS = 7;

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = resolveRepoRoot(import.meta.dirname);
  loadLocalDotEnv(repoRoot);

  const credentials = requireCloudflareCredentials();

  let days = DEFAULT_BACKFILL_DAYS;
  let resetHistory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--days") {
      const rawValue = argv[index + 1];
      const parsedValue = Number(rawValue);
      if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 3650) {
        throw new Error("--days requires a positive integer between 1 and 3650");
      }
      days = parsedValue;
      index += 1;
      continue;
    }

    if (arg === "--reset-history") {
      resetHistory = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    repoRoot,
    ...credentials,
    days,
    resetHistory,
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const capturedAtIso = now.toISOString();

  let history = args.resetHistory
    ? createEmptyWebsiteAnalyticsHistory(args.zoneTag, capturedAtIso)
    : loadWebsiteAnalyticsHistory(args.repoRoot, args.zoneTag, capturedAtIso);

  const endHour = toHourBucketIso(now);
  const startHourDate = new Date(Date.parse(endHour) - (args.days * 24 * 60 * 60 * 1000));

  console.log(
    `Backfilling website analytics hourly snapshots for ${args.days} day(s) from ${startHourDate.toISOString()} to ${endHour}`,
  );

  let capturedHours = 0;
  let skippedHours = 0;

  for (let cursorMs = startHourDate.getTime(); cursorMs < Date.parse(endHour); cursorMs += 60 * 60 * 1000) {
    const windowStartIso = new Date(cursorMs).toISOString();
    const windowEndIso = new Date(cursorMs + 60 * 60 * 1000).toISOString();
    const hourKey = toHourBucketIso(new Date(cursorMs));

    if (!args.resetHistory && history.hourly_snapshots[hourKey]) {
      skippedHours += 1;
      continue;
    }

    console.log(`Fetching hour ${hourKey}...`);
    let hourlySnapshot: WebsiteAnalyticsSnapshot;
    try {
      hourlySnapshot = await captureWindowSnapshot({
        zoneTag: args.zoneTag,
        apiToken: args.apiToken,
        pathAliases: history.path_aliases,
        windowStartIso,
        windowEndIso,
        capturedAtIso,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("cannot request data older than")) {
        throw new Error(
          `Cloudflare retention window exceeded while fetching hour ${hourKey}. Re-run with a smaller window (for example: pnpm --dir scripts run backfill-website-analytics -- --days 7). Original error: ${message}`,
        );
      }
      if (message.includes("Rate limiter budget depleted")) {
        throw new Error(
          `Cloudflare rate limit hit while fetching hour ${hourKey}. Progress is checkpointed in history/website_analytics.json. Wait 5 minutes and re-run the same command to resume. Original error: ${message}`,
        );
      }
      throw error;
    }

    history = upsertHourlySnapshot({
      history,
      snapshot: hourlySnapshot,
      snapshotKey: hourKey,
      updatedAt: capturedAtIso,
    });

    const discoveredPaths = Object.keys(hourlySnapshot.pages).sort();
    history = updateValidPaths(
      history,
      mergeSortedUniqueStrings(history.valid_paths, discoveredPaths),
      capturedAtIso,
    );

    capturedHours += 1;
    if (capturedHours % 24 === 0) {
      writeWebsiteAnalyticsHistory(args.repoRoot, history);
      const dateKey = toDateKey(hourKey) ?? "unknown-date";
      console.log(`Checkpoint saved through ${dateKey} (${capturedHours} hour(s) captured)`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  writeWebsiteAnalyticsHistory(args.repoRoot, history);

  console.log(
    `Backfill complete: captured_hours=${capturedHours}, skipped_hours=${skippedHours}, totalHourlySnapshots=${Object.keys(history.hourly_snapshots).length}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
