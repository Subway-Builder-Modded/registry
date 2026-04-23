import { pathToFileURL } from "node:url";
import {
  createEmptyWebsiteAnalyticsHistory,
  getWebsiteAnalyticsDayFilePath,
  loadWebsiteAnalyticsHistory,
  writeWebsiteAnalyticsHistory,
  writeWebsiteAnalyticsDayFile,
  upsertDailySnapshot,
  updateValidPaths,
  toDateKey,
  normalizeAndCanonicalizePath,
  mergeSortedUniqueStrings,
  sortMetricMap,
  type WebsiteAnalyticsDayFile,
  type WebsiteAnalyticsSnapshot,
  type WebsiteAnalyticsMetricMap,
} from "./lib/website-analytics.js";
import {
  fetchCloudflareWindowMetrics,
  resolveZoneTag,
  resolveApiToken,
  type CloudflareWebsiteAnalyticsQueryParams,
} from "./lib/cloudflare-website-analytics.js";
import { loadLocalDotEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";
import { existsSync } from "node:fs";

interface CliArgs {
  repoRoot: string;
  zoneTag: string;
  apiToken: string;
  days: number;
  resetHistory: boolean;
}

const DEFAULT_BACKFILL_DAYS = 1;

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = resolveRepoRoot(import.meta.dirname);
  loadLocalDotEnv(repoRoot);

  const zoneTag = resolveZoneTag();
  const apiToken = resolveApiToken();

  if (!zoneTag) {
    throw new Error(
      "Cloudflare zone identifier not found. Set CLOUDFLARE_ZONE_TAG.",
    );
  }

  if (!apiToken) {
    throw new Error(
      "Cloudflare API token not found. Set CLOUDFLARE_API_TOKEN.",
    );
  }

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
    zoneTag,
    apiToken,
    days,
    resetHistory,
  };
}

function normalizeMetricMap(
  raw: Record<string, unknown>,
  pathAliases: Record<string, string>,
  canonicalizePath: boolean,
): WebsiteAnalyticsMetricMap {
  const normalized: WebsiteAnalyticsMetricMap = {};

  for (const [key, value] of Object.entries(raw)) {
    const visits = typeof value === "object" && value !== null && "visits" in value
      ? typeof (value as Record<string, unknown>).visits === "number"
        ? (value as Record<string, unknown>).visits as number
        : 0
      : 0;

    if (visits <= 0) continue;

    if (canonicalizePath) {
      const normKey = normalizeAndCanonicalizePath(key, pathAliases);
      if (!normKey) continue;
      if (!normalized[normKey]) {
        normalized[normKey] = 0;
      }
      normalized[normKey] += visits;
    } else {
      normalized[key] = visits;
    }
  }

  return sortMetricMap(normalized);
}

async function captureWindowAnalytics(
  zoneTag: string,
  apiToken: string,
  pathAliases: Record<string, string>,
  windowStartIso: string,
  windowEndIso: string,
  capturedAtIso: string,
): Promise<WebsiteAnalyticsSnapshot> {
  const queryParams: CloudflareWebsiteAnalyticsQueryParams = {
    zoneTag,
    apiToken,
    windowStartIso,
    windowEndIso,
  };

  const metrics = await fetchCloudflareWindowMetrics(queryParams);

  const normalizedPages = normalizeMetricMap(metrics.pages, pathAliases, true);
  const normalizedCountries = normalizeMetricMap(metrics.countries, pathAliases, false);
  const normalizedBrowsers = normalizeMetricMap(metrics.browsers, pathAliases, false);
  const normalizedOs = normalizeMetricMap(metrics.operatingSystems, pathAliases, false);
  const normalizedDevices = normalizeMetricMap(metrics.devices, pathAliases, false);

  return {
    captured_at: capturedAtIso,
    window_start: windowStartIso,
    window_end: windowEndIso,
    totals: {
      visits: metrics.totalVisits,
    },
    pages: normalizedPages,
    countries: normalizedCountries,
    browsers: normalizedBrowsers,
    operating_systems: normalizedOs,
    devices: normalizedDevices,
    screen_sizes: {},
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const capturedAtIso = now.toISOString();

  let history = args.resetHistory
    ? createEmptyWebsiteAnalyticsHistory(args.zoneTag, capturedAtIso)
    : loadWebsiteAnalyticsHistory(args.repoRoot, args.zoneTag, capturedAtIso);

  const endDayStart = new Date(now.toISOString().slice(0, 10));
  const startDayStart = new Date(endDayStart.getTime() - (args.days * 24 * 60 * 60 * 1000));

  console.log(
    `Backfilling website analytics daily snapshots for ${args.days} day(s) from ${startDayStart.toISOString()} to ${endDayStart.toISOString()} (exclusive end)`,
  );

  let capturedDays = 0;
  let skippedDays = 0;

  for (let cursorMs = startDayStart.getTime(); cursorMs < endDayStart.getTime(); cursorMs += 24 * 60 * 60 * 1000) {
    const dayStartIso = new Date(cursorMs).toISOString();
    const dayEndIso = new Date(cursorMs + 24 * 60 * 60 * 1000).toISOString();
    const dayKey = toDateKey(dayStartIso);
    if (!dayKey) continue;
    const dayFilePath = getWebsiteAnalyticsDayFilePath(args.repoRoot, dayKey);

    if (!args.resetHistory && existsSync(dayFilePath)) {
      skippedDays += 1;
      continue;
    }

    console.log(`Fetching day ${dayKey}...`);
    let dailySnapshot: WebsiteAnalyticsSnapshot;
    try {
      dailySnapshot = await captureWindowAnalytics(
        args.zoneTag,
        args.apiToken,
        history.path_aliases,
        dayStartIso,
        dayEndIso,
        capturedAtIso,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("cannot request data older than")) {
        throw new Error(
          `Cloudflare retention window exceeded while fetching day ${dayKey}. Re-run with a smaller window (for example: pnpm --dir scripts run backfill-website-analytics -- --days 1). Original error: ${message}`,
        );
      }
      if (message.includes("Rate limiter budget depleted")) {
        throw new Error(
          `Cloudflare rate limit hit while fetching day ${dayKey}. Already-captured day files are checkpointed under history/website_analytics_by_day/. Wait 5 minutes and re-run the same command to resume. Original error: ${message}`,
        );
      }
      throw error;
    }

    history = upsertDailySnapshot({
      history,
      snapshot: dailySnapshot,
      snapshotKey: dayKey,
      updatedAt: capturedAtIso,
    });

    const discoveredPaths = Object.keys(dailySnapshot.pages).sort();
    history = updateValidPaths(
      history,
      mergeSortedUniqueStrings(history.valid_paths, discoveredPaths),
      capturedAtIso,
    );

    const dayFile: WebsiteAnalyticsDayFile = {
      schema_version: 1,
      zone_tag: history.zone_tag,
      date: dayKey,
      updated_at: capturedAtIso,
      valid_paths: history.valid_paths,
      path_aliases: history.path_aliases,
      daily_snapshot: dailySnapshot,
    };
    writeWebsiteAnalyticsDayFile(args.repoRoot, dayKey, dayFile);

    // Checkpoint after each day.
    writeWebsiteAnalyticsHistory(args.repoRoot, history);
    capturedDays += 1;
    console.log(`Checkpoint saved for day ${dayKey} (${capturedDays} day(s) captured)`);
  }

  writeWebsiteAnalyticsHistory(args.repoRoot, history);

  console.log(
    `Backfill complete: captured_days=${capturedDays}, skipped_days=${skippedDays}, totalDailySnapshots=${Object.keys(history.daily_snapshots).length}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
