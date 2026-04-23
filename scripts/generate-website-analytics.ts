import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadWebsiteAnalyticsHistory,
  loadWebsiteAnalyticsHistoryFromDayFiles,
  listHourlySnapshotKeys,
  listDailySnapshotKeys,
  toDateKey,
  upsertDailySnapshot,
  writeWebsiteAnalyticsHistory,
  type WebsiteAnalyticsSnapshot,
  type WebsiteAnalyticsMetricMap,
} from "./lib/website-analytics.js";
import { writeCsv } from "./lib/csv.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";
import { sortObjectByKeys } from "./lib/json-utils.js";

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
  screen_sizes: WebsiteAnalyticsMetricMap;
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
      screen_sizes: {},
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
    screen_sizes: aggregateMetricMaps(...hourlySnapshots.map((s) => s.screen_sizes)),
  };
}

interface ByCsvRow {
  date_or_hour: string;
  metric: string;
  visits: number;
}

interface ByCsvSummaryRow {
  date_or_hour: string;
  visits: number;
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

  const baseHistory = loadWebsiteAnalyticsHistory(repoRoot);
  const dayHistory = loadWebsiteAnalyticsHistoryFromDayFiles(
    repoRoot,
    baseHistory.zone_tag,
    baseHistory.updated_at,
  );
  const history = {
    ...baseHistory,
    zone_tag: dayHistory.zone_tag || baseHistory.zone_tag,
    updated_at: dayHistory.updated_at || baseHistory.updated_at,
    valid_paths: Array.from(new Set([...baseHistory.valid_paths, ...dayHistory.valid_paths])).sort(),
    path_aliases: sortObjectByKeys({
      ...baseHistory.path_aliases,
      ...dayHistory.path_aliases,
    }),
    daily_snapshots: sortObjectByKeys({
      ...baseHistory.daily_snapshots,
      ...dayHistory.daily_snapshots,
    }),
  };

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

  // Generate CSV exports for each dimension
  // By day CSV
  const byDayRows: ByCsvSummaryRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    byDayRows.push({
      date_or_hour: dateKey,
      visits: snapshot.totals.visits,
    });
  }
  writeCsv(
    join(analyticsDir, "website_analytics_by_day.csv"),
    ["date_or_hour", "visits"],
    byDayRows,
  );

  // By hour CSV (if we have hourly data)
  const byHourRows: ByCsvSummaryRow[] = [];
  for (const hourlyKey of hourlyKeys) {
    const snapshot = history.hourly_snapshots[hourlyKey];
    if (!snapshot) continue;
    byHourRows.push({
      date_or_hour: hourlyKey,
      visits: snapshot.totals.visits,
    });
  }
  writeCsv(
    join(analyticsDir, "website_analytics_by_hour.csv"),
    ["date_or_hour", "visits"],
    byHourRows,
  );

  // Pages CSV
  const pagesRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [page, visits] of Object.entries(snapshot.pages)) {
      pagesRows.push({
        date_or_hour: dateKey,
        metric: page,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_pages.csv"),
    ["date_or_hour", "metric", "visits"],
    pagesRows,
  );

  // Countries CSV
  const countriesRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [country, visits] of Object.entries(snapshot.countries)) {
      countriesRows.push({
        date_or_hour: dateKey,
        metric: country,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_countries.csv"),
    ["date_or_hour", "metric", "visits"],
    countriesRows,
  );

  // Browsers CSV
  const browsersRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [browser, visits] of Object.entries(snapshot.browsers)) {
      browsersRows.push({
        date_or_hour: dateKey,
        metric: browser,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_browsers.csv"),
    ["date_or_hour", "metric", "visits"],
    browsersRows,
  );

  // Operating Systems CSV
  const osRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [os, visits] of Object.entries(snapshot.operating_systems)) {
      osRows.push({
        date_or_hour: dateKey,
        metric: os,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_operating_systems.csv"),
    ["date_or_hour", "metric", "visits"],
    osRows,
  );

  // Devices CSV
  const devicesRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [device, visits] of Object.entries(snapshot.devices)) {
      devicesRows.push({
        date_or_hour: dateKey,
        metric: device,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_devices.csv"),
    ["date_or_hour", "metric", "visits"],
    devicesRows,
  );

  // Screen Sizes CSV (currently empty from Cloudflare)
  const screenSizesRows: ByCsvRow[] = [];
  for (const dateKey of dailyKeys) {
    const snapshot = updatedHistory.daily_snapshots[dateKey];
    if (!snapshot) continue;
    for (const [screenSize, visits] of Object.entries(snapshot.screen_sizes)) {
      screenSizesRows.push({
        date_or_hour: dateKey,
        metric: screenSize,
        visits,
      });
    }
  }
  writeCsv(
    join(analyticsDir, "website_screen_sizes.csv"),
    ["date_or_hour", "metric", "visits"],
    screenSizesRows,
  );

  console.log(
    `Generated website analytics: ${dailyKeys.length} days, ${byHourRows.length} hours, ${pagesRows.length} page records`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
