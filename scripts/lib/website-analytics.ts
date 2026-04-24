import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isObject, toFiniteNonNegativeNumber, sortObjectByKeys } from "./json-utils.js";

const WEBSITE_ANALYTICS_HISTORY_FILE = ["history", "website_analytics.json"] as const;
const WEBSITE_ANALYTICS_DAY_DIR = ["history", "website_analytics_by_day"] as const;

export interface WebsiteAnalyticsDayFile {
  schema_version: 1;
  zone_tag: string;
  date: string;
  updated_at: string;
  valid_paths: string[];
  path_aliases: Record<string, string>;
  daily_snapshot: WebsiteAnalyticsSnapshot;
}

export interface WebsiteAnalyticsMetricMap {
  [label: string]: number;
}

export interface WebsiteAnalyticsSnapshot {
  captured_at: string;          // ISO timestamp when fetched
  window_start: string;         // ISO inclusive lower bound
  window_end: string;           // ISO exclusive upper bound
  totals: {
    visits: number;
  };
  pages: WebsiteAnalyticsMetricMap;
  countries: WebsiteAnalyticsMetricMap;
  browsers: WebsiteAnalyticsMetricMap;
  operating_systems: WebsiteAnalyticsMetricMap;
  devices: WebsiteAnalyticsMetricMap;
}

export interface WebsiteAnalyticsHistory {
  schema_version: 1;
  zone_tag: string;
  updated_at: string;
  valid_paths: string[];
  path_aliases: Record<string, string>;
  hourly_snapshots: Record<string, WebsiteAnalyticsSnapshot>; // key = hour bucket ISO
  daily_snapshots: Record<string, WebsiteAnalyticsSnapshot>;  // key = YYYY-MM-DD
}

export interface WebsiteAnalyticsDaily {
  schema_version: 1;
  zone_tag: string;
  generated_at: string;
  start_date: string | null;
  end_date: string | null;
  snapshots: Record<string, WebsiteAnalyticsSnapshot>; // key = YYYY-MM-DD
}

export interface WebsiteAnalyticsByCsvRow {
  date_or_hour: string;
  visits: number;
  [key: string]: string | number;
}

export function sortMetricMap(map: WebsiteAnalyticsMetricMap): WebsiteAnalyticsMetricMap {
  return sortObjectByKeys(
    Object.fromEntries(
      Object.entries(map)
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
        .map(([key, value]) => ([key, value]),
        ),
    ),
  );
}

export function getWebsiteAnalyticsHistoryPath(repoRoot: string): string {
  return resolve(repoRoot, ...WEBSITE_ANALYTICS_HISTORY_FILE);
}

export function getWebsiteAnalyticsDayDirPath(repoRoot: string): string {
  return resolve(repoRoot, ...WEBSITE_ANALYTICS_DAY_DIR);
}

export function toUnderscoreDateKey(dateKey: string): string {
  return dateKey.replaceAll("-", "_");
}

export function getWebsiteAnalyticsDayFilePath(repoRoot: string, dateKey: string): string {
  return join(
    getWebsiteAnalyticsDayDirPath(repoRoot),
    `website_analytics_${toUnderscoreDateKey(dateKey)}.json`,
  );
}

export function toHourBucketIso(date: Date): string {
  const bucket = new Date(date.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function toDateKey(isoValue: string): string | null {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeMetricMap(value: unknown): WebsiteAnalyticsMetricMap {
  const map: WebsiteAnalyticsMetricMap = {};
  if (isObject(value)) {
    for (const [label, count] of Object.entries(value)) {
      const parsed = toFiniteNonNegativeNumber(count);
      if (parsed === null) continue;
      map[label] = parsed;
    }
  }
  return sortObjectByKeys(map);
}

function normalizeSnapshot(value: unknown): WebsiteAnalyticsSnapshot | null {
  if (!isObject(value)) return null;

  const capturedAt = typeof value.captured_at === "string" ? value.captured_at : null;
  const windowStart = typeof value.window_start === "string" ? value.window_start : null;
  const windowEnd = typeof value.window_end === "string" ? value.window_end : null;

  if (!capturedAt || !windowStart || !windowEnd) return null;

  let totalVisits = 0;
  if (isObject(value.totals)) {
    const visits = toFiniteNonNegativeNumber(value.totals.visits);
    if (visits !== null) {
      totalVisits = visits;
    }
  }

  return {
    captured_at: capturedAt,
    window_start: windowStart,
    window_end: windowEnd,
    totals: {
      visits: totalVisits,
    },
    pages: normalizeMetricMap(value.pages),
    countries: normalizeMetricMap(value.countries),
    browsers: normalizeMetricMap(value.browsers),
    operating_systems: normalizeMetricMap(value.operating_systems),
    devices: normalizeMetricMap(value.devices),
  };
}

function normalizeDayFile(
  value: unknown,
  fallbackZoneTag: string,
  fallbackDate: string,
  nowIso: string,
): WebsiteAnalyticsDayFile | null {
  if (!isObject(value) || value.schema_version !== 1) {
    return null;
  }

  const snapshot = normalizeSnapshot(value.daily_snapshot);
  if (!snapshot) return null;

  const validPaths: string[] = [];
  if (Array.isArray(value.valid_paths)) {
    for (const item of value.valid_paths) {
      if (typeof item === "string" && item.trim() !== "") {
        validPaths.push(item);
      }
    }
  }

  const pathAliases: Record<string, string> = {};
  if (isObject(value.path_aliases)) {
    for (const [key, val] of Object.entries(value.path_aliases)) {
      if (typeof val === "string" && val.trim() !== "") {
        pathAliases[key] = val;
      }
    }
  }

  return {
    schema_version: 1,
    zone_tag: typeof value.zone_tag === "string" && value.zone_tag.trim() !== ""
      ? value.zone_tag
      : fallbackZoneTag,
    date: typeof value.date === "string" && value.date.trim() !== ""
      ? value.date
      : fallbackDate,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    valid_paths: validPaths.sort(),
    path_aliases: sortObjectByKeys(pathAliases),
    daily_snapshot: snapshot,
  };
}

export function createEmptyWebsiteAnalyticsHistory(
  zoneTag = "",
  nowIso = new Date().toISOString(),
): WebsiteAnalyticsHistory {
  return {
    schema_version: 1,
    zone_tag: zoneTag,
    updated_at: nowIso,
    valid_paths: [],
    path_aliases: {},
    hourly_snapshots: {},
    daily_snapshots: {},
  };
}

export function normalizeWebsiteAnalyticsHistory(
  value: unknown,
  fallbackZoneTag = "",
  nowIso = new Date().toISOString(),
): WebsiteAnalyticsHistory {
  if (!isObject(value) || value.schema_version !== 1) {
    return createEmptyWebsiteAnalyticsHistory(fallbackZoneTag, nowIso);
  }

  const validPaths: string[] = [];
  if (Array.isArray(value.valid_paths)) {
    for (const item of value.valid_paths) {
      if (typeof item === "string" && item.trim() !== "") {
        validPaths.push(item);
      }
    }
  }

  const pathAliases: Record<string, string> = {};
  if (isObject(value.path_aliases)) {
    for (const [key, val] of Object.entries(value.path_aliases)) {
      if (typeof val === "string" && val.trim() !== "") {
        pathAliases[key] = val;
      }
    }
  }

  const hourlySnapshots: Record<string, WebsiteAnalyticsSnapshot> = {};
  if (isObject(value.hourly_snapshots)) {
    for (const [key, val] of Object.entries(value.hourly_snapshots)) {
      const normalized = normalizeSnapshot(val);
      if (normalized) {
        hourlySnapshots[key] = normalized;
      }
    }
  }

  const dailySnapshots: Record<string, WebsiteAnalyticsSnapshot> = {};
  if (isObject(value.daily_snapshots)) {
    for (const [key, val] of Object.entries(value.daily_snapshots)) {
      const normalized = normalizeSnapshot(val);
      if (normalized) {
        dailySnapshots[key] = normalized;
      }
    }
  }

  return {
    schema_version: 1,
    zone_tag: typeof value.zone_tag === "string" && value.zone_tag.trim() !== ""
      ? value.zone_tag
      : fallbackZoneTag,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    valid_paths: validPaths.sort(),
    path_aliases: sortObjectByKeys(pathAliases),
    hourly_snapshots: sortObjectByKeys(hourlySnapshots),
    daily_snapshots: sortObjectByKeys(dailySnapshots),
  };
}

export function loadWebsiteAnalyticsHistory(
  repoRoot: string,
  fallbackZoneTag = "",
  nowIso = new Date().toISOString(),
): WebsiteAnalyticsHistory {
  const path = getWebsiteAnalyticsHistoryPath(repoRoot);
  if (!existsSync(path)) {
    return createEmptyWebsiteAnalyticsHistory(fallbackZoneTag, nowIso);
  }
  return normalizeWebsiteAnalyticsHistory(
    JSON.parse(readFileSync(path, "utf-8")) as unknown,
    fallbackZoneTag,
    nowIso,
  );
}

export function writeWebsiteAnalyticsHistory(
  repoRoot: string,
  history: WebsiteAnalyticsHistory,
): void {
  writeFileSync(
    getWebsiteAnalyticsHistoryPath(repoRoot),
    `${JSON.stringify(history, null, 2)}\n`,
    "utf-8",
  );
}

export function writeWebsiteAnalyticsDayFile(
  repoRoot: string,
  dateKey: string,
  dayFile: WebsiteAnalyticsDayFile,
): void {
  const dayDir = getWebsiteAnalyticsDayDirPath(repoRoot);
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(
    getWebsiteAnalyticsDayFilePath(repoRoot, dateKey),
    `${JSON.stringify(dayFile, null, 2)}\n`,
    "utf-8",
  );
}

export function listWebsiteAnalyticsDayFiles(repoRoot: string): string[] {
  const dayDir = getWebsiteAnalyticsDayDirPath(repoRoot);
  if (!existsSync(dayDir)) {
    return [];
  }
  return readdirSync(dayDir)
    .filter((name) => name.startsWith("website_analytics_") && name.endsWith(".json"))
    .sort()
    .map((name) => join(dayDir, name));
}

export function loadWebsiteAnalyticsHistoryFromDayFiles(
  repoRoot: string,
  fallbackZoneTag = "",
  nowIso = new Date().toISOString(),
): WebsiteAnalyticsHistory {
  const files = listWebsiteAnalyticsDayFiles(repoRoot);
  if (files.length === 0) {
    return createEmptyWebsiteAnalyticsHistory(fallbackZoneTag, nowIso);
  }

  let zoneTag = fallbackZoneTag;
  let updatedAt = nowIso;
  let validPaths: string[] = [];
  let pathAliases: Record<string, string> = {};
  const dailySnapshots: Record<string, WebsiteAnalyticsSnapshot> = {};

  for (const filePath of files) {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    const normalized = normalizeDayFile(raw, zoneTag, "", nowIso);
    if (!normalized) continue;
    zoneTag = normalized.zone_tag;
    if (normalized.updated_at > updatedAt) {
      updatedAt = normalized.updated_at;
    }
    validPaths = mergeSortedUniqueStrings(validPaths, normalized.valid_paths);
    pathAliases = sortObjectByKeys({
      ...pathAliases,
      ...normalized.path_aliases,
    });
    dailySnapshots[normalized.date] = normalized.daily_snapshot;
  }

  return {
    schema_version: 1,
    zone_tag: zoneTag,
    updated_at: updatedAt,
    valid_paths: validPaths,
    path_aliases: pathAliases,
    hourly_snapshots: {},
    daily_snapshots: sortObjectByKeys(dailySnapshots),
  };
}

export function upsertHourlySnapshot(params: {
  history: WebsiteAnalyticsHistory;
  snapshot: WebsiteAnalyticsSnapshot;
  snapshotKey: string;
  updatedAt?: string;
}): WebsiteAnalyticsHistory {
  return {
    schema_version: 1,
    zone_tag: params.history.zone_tag,
    updated_at: params.updatedAt ?? params.snapshot.captured_at,
    valid_paths: params.history.valid_paths,
    path_aliases: params.history.path_aliases,
    hourly_snapshots: sortObjectByKeys({
      ...params.history.hourly_snapshots,
      [params.snapshotKey]: params.snapshot,
    }),
    daily_snapshots: params.history.daily_snapshots,
  };
}

export function upsertDailySnapshot(params: {
  history: WebsiteAnalyticsHistory;
  snapshot: WebsiteAnalyticsSnapshot;
  snapshotKey: string;
  updatedAt?: string;
}): WebsiteAnalyticsHistory {
  return {
    schema_version: 1,
    zone_tag: params.history.zone_tag,
    updated_at: params.updatedAt ?? params.snapshot.captured_at,
    valid_paths: params.history.valid_paths,
    path_aliases: params.history.path_aliases,
    hourly_snapshots: params.history.hourly_snapshots,
    daily_snapshots: sortObjectByKeys({
      ...params.history.daily_snapshots,
      [params.snapshotKey]: params.snapshot,
    }),
  };
}

export function updateValidPaths(
  history: WebsiteAnalyticsHistory,
  validPaths: string[],
  updatedAt?: string,
): WebsiteAnalyticsHistory {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    zone_tag: history.zone_tag,
    updated_at: updatedAt ?? now,
    valid_paths: validPaths.sort(),
    path_aliases: history.path_aliases,
    hourly_snapshots: history.hourly_snapshots,
    daily_snapshots: history.daily_snapshots,
  };
}

export function updatePathAliases(
  history: WebsiteAnalyticsHistory,
  pathAliases: Record<string, string>,
  updatedAt?: string,
): WebsiteAnalyticsHistory {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    zone_tag: history.zone_tag,
    updated_at: updatedAt ?? now,
    valid_paths: history.valid_paths,
    path_aliases: sortObjectByKeys(pathAliases),
    hourly_snapshots: history.hourly_snapshots,
    daily_snapshots: history.daily_snapshots,
  };
}

export function listHourlySnapshotKeys(history: WebsiteAnalyticsHistory): string[] {
  return Object.keys(history.hourly_snapshots).sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );
}

export function listDailySnapshotKeys(history: WebsiteAnalyticsHistory): string[] {
  return Object.keys(history.daily_snapshots).sort();
}

export function buildDailyAnalyticsFromDaily(
  history: WebsiteAnalyticsHistory,
  generatedAt = new Date().toISOString(),
): WebsiteAnalyticsDaily {
  const dailyKeys = listDailySnapshotKeys(history);
  const startDate = dailyKeys[0] ?? null;
  const endDate = dailyKeys[dailyKeys.length - 1] ?? null;

  return {
    schema_version: 1,
    zone_tag: history.zone_tag,
    generated_at: generatedAt,
    start_date: startDate,
    end_date: endDate,
    snapshots: sortObjectByKeys(history.daily_snapshots),
  };
}

export function normalizePath(path: string): string | null {
  // trim whitespace
  let normalized = path.trim();

  // remove hash
  const hashIndex = normalized.indexOf("#");
  if (hashIndex >= 0) {
    normalized = normalized.substring(0, hashIndex);
  }

  // remove query string
  const queryIndex = normalized.indexOf("?");
  if (queryIndex >= 0) {
    normalized = normalized.substring(0, queryIndex);
  }

  // force leading slash
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }

  // collapse trailing slashes except for "/"
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  const lower = normalized.toLowerCase();

  // reject likely 404 paths
  if (
    lower === "/404" ||
    lower.startsWith("/404/") ||
    lower.includes("/_not-found") ||
    lower.includes("/not-found")
  ) {
    return null;
  }

  // reject empty or whitespace-only paths
  if (normalized === "/" || normalized.trim() === "") {
    return "/";
  }

  return normalized;
}

export function resolvePathAlias(path: string, pathAliases: Record<string, string>): string {
  let current = path;
  const seen = new Set<string>([current]);

  for (let depth = 0; depth < 32; depth += 1) {
    const next = pathAliases[current];
    if (typeof next !== "string" || next.trim() === "") {
      return current;
    }
    if (seen.has(next)) {
      return current;
    }
    seen.add(next);
    current = next;
  }

  return current;
}

export function normalizeAndCanonicalizePath(
  path: string,
  pathAliases: Record<string, string>,
): string | null {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  const canonical = resolvePathAlias(normalized, pathAliases);
  return normalizePath(canonical);
}

export function mergeSortedUniqueStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}
