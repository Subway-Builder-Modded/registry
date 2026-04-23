import { fetchWithTimeout } from "./http.js";
import { getNonEmptyEnv } from "./script-runtime.js";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/graphql";
const FETCH_TIMEOUT_MS = 45_000;

export interface CloudflareWebsiteAnalyticsQueryParams {
  zoneTag: string;
  apiToken: string;
  windowStartIso: string;  // ISO 8601, inclusive
  windowEndIso: string;    // ISO 8601, exclusive
}

export interface CloudflareVisitsMetric {
  visits: number;
}

export interface CloudflarePageMetrics {
  [path: string]: CloudflareVisitsMetric;
}

export interface CloudflareCountryMetrics {
  [country: string]: CloudflareVisitsMetric;
}

export interface CloudflareBrowserMetrics {
  [browser: string]: CloudflareVisitsMetric;
}

export interface CloudflareOsMetrics {
  [os: string]: CloudflareVisitsMetric;
}

export interface CloudflareDeviceMetrics {
  [device: string]: CloudflareVisitsMetric;
}

export interface CloudflareAnalyticsResponse {
  data: {
    viewer?: {
      zones?: Array<{
        httpRequestsAdaptiveGroups?: Array<{
          count?: number;
          sum?: {
            visits?: number;
          };
          dimensions?: {
            clientRequestPath?: string;
            clientCountryName?: string;
            userAgentBrowser?: string;
            userAgentOS?: string;
            clientDeviceType?: string;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message?: string;
  }>;
}

type CloudflareDimension =
  | "clientRequestPath"
  | "clientCountryName"
  | "userAgentBrowser"
  | "userAgentOS"
  | "clientDeviceType";

interface GraphQlEnvelope {
  query: string;
  variables: {
    zoneTag: string;
    windowStart: string;
    windowEnd: string;
  };
}

export function resolveZoneTag(): string | null {
  return getNonEmptyEnv("CLOUDFLARE_ZONE_TAG") ?? null;
}

export function resolveApiToken(): string | null {
  return getNonEmptyEnv("CLOUDFLARE_API_TOKEN") ?? null;
}

export async function queryCloudflareAnalytics(
  params: CloudflareWebsiteAnalyticsQueryParams,
  query: string,
): Promise<CloudflareAnalyticsResponse> {
  const payload: GraphQlEnvelope = {
    query,
    variables: {
      zoneTag: params.zoneTag,
      windowStart: params.windowStartIso,
      windowEnd: params.windowEndIso,
    },
  };

  const response = await fetchWithTimeout(
    fetch,
    CLOUDFLARE_API_BASE,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiToken}`,
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      heartbeatPrefix: "[cloudflare-analytics]",
      heartbeatLabel: `query window=${params.windowStartIso} to ${params.windowEndIso}`,
    },
  );

  if (!response.ok) {
    throw new Error(`Cloudflare API returned HTTP ${response.status}`);
  }

  const data = await response.json() as CloudflareAnalyticsResponse;

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const messages = data.errors.map((e) => e.message ?? "Unknown error").join("; ");
    throw new Error(`Cloudflare GraphQL errors: ${messages}`);
  }

  return data;
}

export interface CloudflareRawMetrics {
  totalVisits: number;
  pages: CloudflarePageMetrics;
  countries: CloudflareCountryMetrics;
  browsers: CloudflareBrowserMetrics;
  operatingSystems: CloudflareOsMetrics;
  devices: CloudflareDeviceMetrics;
}

const TOTAL_VISITS_QUERY = `
query($zoneTag: string!, $windowStart: Time!, $windowEnd: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 1
        filter: { datetime_geq: $windowStart, datetime_lt: $windowEnd }
      ) {
        sum {
          visits
        }
      }
    }
  }
}
`;

function buildDimensionQuery(dimension: CloudflareDimension): string {
  return `
query($zoneTag: string!, $windowStart: Time!, $windowEnd: Time!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $windowStart, datetime_lt: $windowEnd }
        orderBy: [sum_visits_DESC]
      ) {
        sum {
          visits
        }
        dimensions {
          ${dimension}
        }
      }
    }
  }
}
`;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function extractGroups(response: CloudflareAnalyticsResponse): Array<{
  sum?: { visits?: number };
  dimensions?: Record<string, unknown>;
}> {
  return response.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];
}

async function queryTotalVisits(params: CloudflareWebsiteAnalyticsQueryParams): Promise<number> {
  const response = await queryCloudflareAnalytics(params, TOTAL_VISITS_QUERY);
  const groups = extractGroups(response);
  const first = groups[0];
  return toNumber(first?.sum?.visits);
}

async function queryVisitsByDimension(
  params: CloudflareWebsiteAnalyticsQueryParams,
  dimension: CloudflareDimension,
): Promise<Record<string, number>> {
  const response = await queryCloudflareAnalytics(params, buildDimensionQuery(dimension));
  const groups = extractGroups(response);
  const metrics: Record<string, number> = {};

  for (const group of groups) {
    const visits = toNumber(group.sum?.visits);
    if (visits <= 0) continue;
    const labelValue = group.dimensions?.[dimension];
    if (typeof labelValue !== "string" || labelValue.trim() === "") continue;
    const label = labelValue.trim();
    metrics[label] = (metrics[label] ?? 0) + visits;
  }

  return metrics;
}

export async function fetchCloudflareWindowMetrics(
  params: CloudflareWebsiteAnalyticsQueryParams,
): Promise<CloudflareRawMetrics> {
  const [totalVisits, pages, countries, browsers, operatingSystems, devices] = await Promise.all([
    queryTotalVisits(params),
    queryVisitsByDimension(params, "clientRequestPath"),
    queryVisitsByDimension(params, "clientCountryName"),
    queryVisitsByDimension(params, "userAgentBrowser"),
    queryVisitsByDimension(params, "userAgentOS"),
    queryVisitsByDimension(params, "clientDeviceType"),
  ]);

  return {
    totalVisits,
    pages: Object.fromEntries(Object.entries(pages).map(([k, v]) => ([k, { visits: v }]))) as CloudflarePageMetrics,
    countries: Object.fromEntries(Object.entries(countries).map(([k, v]) => ([k, { visits: v }]))) as CloudflareCountryMetrics,
    browsers: Object.fromEntries(Object.entries(browsers).map(([k, v]) => ([k, { visits: v }]))) as CloudflareBrowserMetrics,
    operatingSystems: Object.fromEntries(Object.entries(operatingSystems).map(([k, v]) => ([k, { visits: v }]))) as CloudflareOsMetrics,
    devices: Object.fromEntries(Object.entries(devices).map(([k, v]) => ([k, { visits: v }]))) as CloudflareDeviceMetrics,
  };
}

export function parseCloudflareAnalyticsResponse(
  response: CloudflareAnalyticsResponse,
): CloudflareRawMetrics {
  const metrics: CloudflareRawMetrics = {
    totalVisits: 0,
    pages: {},
    countries: {},
    browsers: {},
    operatingSystems: {},
    devices: {},
  };

  const groups = response.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];

  for (const group of groups) {
    const visits = group.sum?.visits ?? 0;
    if (visits <= 0) continue;

    metrics.totalVisits += visits;

    const dims = group.dimensions ?? {};

    // pages dimension
    const path = dims.clientRequestPath;
    if (typeof path === "string") {
      metrics.pages[path] = { visits };
    }

    // countries dimension
    const country = dims.clientCountryName;
    if (typeof country === "string") {
      if (!metrics.countries[country]) {
        metrics.countries[country] = { visits: 0 };
      }
      metrics.countries[country].visits += visits;
    }

    // browsers dimension
    const browser = dims.userAgentBrowser;
    if (typeof browser === "string") {
      if (!metrics.browsers[browser]) {
        metrics.browsers[browser] = { visits: 0 };
      }
      metrics.browsers[browser].visits += visits;
    }

    // operating systems dimension
    const os = dims.userAgentOS;
    if (typeof os === "string") {
      if (!metrics.operatingSystems[os]) {
        metrics.operatingSystems[os] = { visits: 0 };
      }
      metrics.operatingSystems[os].visits += visits;
    }

    // devices dimension
    const device = dims.clientDeviceType;
    if (typeof device === "string") {
      if (!metrics.devices[device]) {
        metrics.devices[device] = { visits: 0 };
      }
      metrics.devices[device].visits += visits;
    }
  }

  return metrics;
}
