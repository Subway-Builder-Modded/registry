import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadWebsiteAnalyticsHistory,
  listHourlySnapshotKeys,
  listDailySnapshotKeys,
  toDateKey,
  upsertDailySnapshot,
  writeWebsiteAnalyticsHistory,
  type WebsiteAnalyticsSnapshot,
  type WebsiteAnalyticsMetricMap,
} from "../lib/website-analytics.js";
import { resolveRepoRoot } from "../lib/script-runtime.js";
import { sortObjectByKeys } from "../lib/json-utils.js";

interface AggregatedSnapshot {
  captured_at: string;
  window_start: string;
  window_end: string;
  totals: {
    visits: number;
  };
  pages: WebsiteAnalyticsMetricMap;
  countries: WebsiteAnalyticsMetricMap;
  browsers: WebsiteAnalyticsMetricMap;
  operating_systems: WebsiteAnalyticsMetricMap;
  devices: WebsiteAnalyticsMetricMap;
}

function aggregateMetricMaps(...maps: WebsiteAnalyticsMetricMap[]): WebsiteAnalyticsMetricMap {
  const result: WebsiteAnalyticsMetricMap = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      result[key] = (result[key] ?? 0) + value;
    }
  }
  return sortObjectByKeys(result);
}

function aggregateHourlyToDaily(hourlySnapshots: WebsiteAnalyticsSnapshot[]): AggregatedSnapshot {
  if (hourlySnapshots.length === 0) {
    return {
      captured_at: new Date().toISOString(),
      window_start: new Date().toISOString(),
      window_end: new Date().toISOString(),
      totals: { visits: 0 },
      pages: {},
      countries: {},
      browsers: {},
      operating_systems: {},
      devices: {},
    };
  }

  const first = hourlySnapshots[0];
  const last = hourlySnapshots[hourlySnapshots.length - 1];

  return {
    captured_at: last.captured_at,
    window_start: first.window_start,
    window_end: last.window_end,
    totals: {
      visits: hourlySnapshots.reduce((sum, s) => sum + s.totals.visits, 0),
    },
    pages: aggregateMetricMaps(...hourlySnapshots.map((s) => s.pages)),
    countries: aggregateMetricMaps(...hourlySnapshots.map((s) => s.countries)),
    browsers: aggregateMetricMaps(...hourlySnapshots.map((s) => s.browsers)),
    operating_systems: aggregateMetricMaps(...hourlySnapshots.map((s) => s.operating_systems)),
    devices: aggregateMetricMaps(...hourlySnapshots.map((s) => s.devices)),
  };
}


interface WebsiteAnalyticsExport {
  schema_version: 1;
  zone_tag: string;
  generated_at: string;
  valid_paths: string[];
  path_aliases: Record<string, string>;
  summary: {
    latest_day: string | null;
    latest_hour: string | null;
    total_days: number;
    total_hours: number;
    latest_day_visits: number;
    latest_hour_visits: number;
  };
  time_series: {
    by_day: Array<{ date: string; visits: number }>;
    by_hour: Array<{ hour: string; visits: number }>;
  };
  snapshots: Record<string, WebsiteAnalyticsSnapshot>;
}

function run(): void {
  const repoRoot = resolveRepoRoot(import.meta.dirname);
  const analyticsDir = join(repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const history = loadWebsiteAnalyticsHistory(repoRoot);

  // Aggregate hourly to daily
  const hourlyKeys = listHourlySnapshotKeys(history);
  const dailyMap = new Map<string, WebsiteAnalyticsSnapshot[]>();

  for (const hourlyKey of hourlyKeys) {
    const snapshot = history.hourly_snapshots[hourlyKey];
    if (!snapshot) continue;

    const dateKey = toDateKey(hourlyKey);
    if (!dateKey) continue;

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, []);
    }
    dailyMap.get(dateKey)!.push(snapshot);
  }

  // Update daily snapshots from aggregated hourly data
  let updatedHistory = history;
  for (const [dateKey, hourlySnapshots] of dailyMap.entries()) {
    const aggregated = aggregateHourlyToDaily(hourlySnapshots);
    updatedHistory = upsertDailySnapshot({
      history: updatedHistory,
      snapshot: aggregated,
      snapshotKey: dateKey,
    });
  }

  writeWebsiteAnalyticsHistory(repoRoot, updatedHistory);

  // Generate daily analytics export
  const dailyKeys = listDailySnapshotKeys(updatedHistory);
  const latestDailyKey = dailyKeys[dailyKeys.length - 1] ?? null;
  const latestHourlyKey = hourlyKeys[hourlyKeys.length - 1] ?? null;
  const exportPayload: WebsiteAnalyticsExport = {
    schema_version: 1,
    zone_tag: updatedHistory.zone_tag,
    generated_at: new Date().toISOString(),
    valid_paths: [...updatedHistory.valid_paths].sort(),
    path_aliases: sortObjectByKeys(updatedHistory.path_aliases),
    summary: {
      latest_day: latestDailyKey,
      latest_hour: latestHourlyKey,
      total_days: dailyKeys.length,
      total_hours: hourlyKeys.length,
      latest_day_visits: latestDailyKey ? (updatedHistory.daily_snapshots[latestDailyKey]?.totals.visits ?? 0) : 0,
      latest_hour_visits: latestHourlyKey ? (updatedHistory.hourly_snapshots[latestHourlyKey]?.totals.visits ?? 0) : 0,
    },
    time_series: {
      by_day: dailyKeys.map((date) => ({
        date,
        visits: updatedHistory.daily_snapshots[date]?.totals.visits ?? 0,
      })),
      by_hour: hourlyKeys.map((hour) => ({
        hour,
        visits: updatedHistory.hourly_snapshots[hour]?.totals.visits ?? 0,
      })),
    },
    snapshots: updatedHistory.daily_snapshots,
  };
  writeFileSync(
    join(analyticsDir, "website_analytics.json"),
    `${JSON.stringify(exportPayload, null, 2)}\n`,
    "utf-8",
  );

  console.log(
    `Generated website analytics: ${dailyKeys.length} days, ${hourlyKeys.length} hours`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
