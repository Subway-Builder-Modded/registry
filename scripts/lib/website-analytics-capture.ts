import {
  normalizeAndCanonicalizePath,
  sortMetricMap,
  type WebsiteAnalyticsSnapshot,
  type WebsiteAnalyticsMetricMap,
} from "./website-analytics.js";
import {
  fetchCloudflareWindowMetrics,
  resolveZoneTag,
  resolveApiToken,
  type CloudflareWebsiteAnalyticsQueryParams,
} from "./cloudflare-website-analytics.js";

export interface CloudflareCredentials {
  zoneTag: string;
  apiToken: string;
}

export function requireCloudflareCredentials(): CloudflareCredentials {
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

  return { zoneTag, apiToken };
}

function normalizeCloudflareMetricMap(
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

export interface CaptureWindowSnapshotArgs extends CloudflareCredentials {
  pathAliases: Record<string, string>;
  windowStartIso: string;
  windowEndIso: string;
  capturedAtIso: string;
  verbose?: boolean;
}

/**
 * Fetches one Cloudflare analytics window and normalizes it into a
 * WebsiteAnalyticsSnapshot (page paths canonicalized via the alias map; other
 * dimensions passed through). Shared by the hourly capture script and the
 * ops backfill gap-filler.
 */
export async function captureWindowSnapshot(
  args: CaptureWindowSnapshotArgs,
): Promise<WebsiteAnalyticsSnapshot> {
  const queryParams: CloudflareWebsiteAnalyticsQueryParams = {
    zoneTag: args.zoneTag,
    apiToken: args.apiToken,
    windowStartIso: args.windowStartIso,
    windowEndIso: args.windowEndIso,
  };

  if (args.verbose) {
    console.log(
      `Querying Cloudflare for window ${args.windowStartIso} to ${args.windowEndIso}...`,
    );
  }
  const metrics = await fetchCloudflareWindowMetrics(queryParams);

  if (args.verbose) {
    console.log(
      `Received ${metrics.totalVisits} total visits, ${Object.keys(metrics.pages).length} pages`,
    );
  }

  return {
    captured_at: args.capturedAtIso,
    window_start: args.windowStartIso,
    window_end: args.windowEndIso,
    totals: {
      visits: metrics.totalVisits,
    },
    pages: normalizeCloudflareMetricMap(metrics.pages, args.pathAliases, true),
    countries: normalizeCloudflareMetricMap(metrics.countries, args.pathAliases, false),
    browsers: normalizeCloudflareMetricMap(metrics.browsers, args.pathAliases, false),
    operating_systems: normalizeCloudflareMetricMap(metrics.operatingSystems, args.pathAliases, false),
    devices: normalizeCloudflareMetricMap(metrics.devices, args.pathAliases, false),
  };
}
