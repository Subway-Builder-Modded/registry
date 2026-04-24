import { pathToFileURL } from "node:url";
import {
  loadWebsiteAnalyticsHistory,
  writeWebsiteAnalyticsHistory,
  upsertHourlySnapshot,
  updateValidPaths,
  toHourBucketIso,
  normalizeAndCanonicalizePath,
  mergeSortedUniqueStrings,
  sortMetricMap,
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

interface CliArgs {
  repoRoot: string;
  zoneTag: string;
  apiToken: string;
}

function parseArgs(): CliArgs {
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

  return {
    repoRoot,
    zoneTag,
    apiToken,
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

  console.log(
    `Querying Cloudflare for window ${windowStartIso} to ${windowEndIso}...`,
  );
  const metrics = await fetchCloudflareWindowMetrics(queryParams);

  console.log(
    `Received ${metrics.totalVisits} total visits, ${Object.keys(metrics.pages).length} pages`,
  );

  // Normalize pages with path filtering
  const normalizedPages = normalizeMetricMap(metrics.pages, pathAliases, true);

  // Other dimensions: no special normalization needed
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
  };
}

async function run(): Promise<void> {
  const args = parseArgs();
  const now = new Date();
  const capturedAtIso = now.toISOString();
  const hourBucketIso = toHourBucketIso(now);

  // Load existing history
  let history = loadWebsiteAnalyticsHistory(args.repoRoot, args.zoneTag, capturedAtIso);

  // Capture the current hour
  const windowStartIso = hourBucketIso;
  const windowEndIso = new Date(new Date(windowStartIso).getTime() + 60 * 60 * 1000).toISOString();

  const snapshot = await captureWindowAnalytics(
    args.zoneTag,
    args.apiToken,
    history.path_aliases,
    windowStartIso,
    windowEndIso,
    capturedAtIso,
  );

  // Upsert the hourly snapshot
  history = upsertHourlySnapshot({
    history,
    snapshot,
    snapshotKey: hourBucketIso,
    updatedAt: capturedAtIso,
  });

  const discoveredPaths = Object.keys(snapshot.pages).sort();
  history = updateValidPaths(
    history,
    mergeSortedUniqueStrings(history.valid_paths, discoveredPaths),
    capturedAtIso,
  );

  // Write back to history file
  writeWebsiteAnalyticsHistory(args.repoRoot, history);

  console.log(
    `Captured website analytics for hour ${hourBucketIso} (visits=${snapshot.totals.visits}, pages=${Object.keys(snapshot.pages).length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
