import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadDownloadAttributionLedger,
  type DownloadAttributionLedger,
} from "./download-attribution.js";

const ATTRIBUTION_SNAPSHOT_PATTERN = /^download_attribution_(\d{4}_\d{2}_\d{2})\.json$/;

export interface DownloadAttributionHistorySnapshot {
  schema_version: 1;
  snapshot_date: string;
  generated_at: string;
  source_ledger_updated_at: string;
  total_attributed_fetches: number;
  net_attributed_fetches: number;
  daily_attributed_fetches: number;
  assets_daily: Record<string, number>;
}

export interface GenerateDownloadAttributionHistoryOptions {
  repoRoot: string;
  now?: Date;
}

export interface GenerateDownloadAttributionHistoryResult {
  snapshotFile: string;
  previousSnapshotFile: string | null;
  snapshot: DownloadAttributionHistorySnapshot;
  warnings: string[];
}

export interface BackfillDownloadAttributionHistoryOptions {
  repoRoot: string;
}

export interface BackfillDownloadAttributionHistoryResult {
  updatedFiles: string[];
  warnings: string[];
}

function toSnapshotDate(now: Date): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "_");
}

function getHistoryDir(repoRoot: string): string {
  return resolve(repoRoot, "history");
}

function sortObjectByKeys<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

function hasDailyBuckets(ledger: DownloadAttributionLedger): boolean {
  return Object.keys(ledger.daily).length > 0;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function sumLedgerTotal(ledger: DownloadAttributionLedger): number {
  let total = 0;
  for (const entry of Object.values(ledger.assets)) {
    if (typeof entry.count === "number" && Number.isFinite(entry.count)) {
      total += entry.count;
    }
  }
  return total;
}

function sumLedgerTotalUpToDate(ledger: DownloadAttributionLedger, snapshotDate: string): number {
  const dailyKeys = Object.keys(ledger.daily).sort();
  if (dailyKeys.length === 0) {
    return sumLedgerTotal(ledger);
  }

  let total = 0;
  for (const dateKey of dailyKeys) {
    if (dateKey > snapshotDate) {
      break;
    }
    const entry = ledger.daily[dateKey];
    if (typeof entry?.total === "number" && Number.isFinite(entry.total)) {
      total += entry.total;
      continue;
    }
    if (entry?.assets) {
      total += Object.values(entry.assets).reduce((sum, value) => sum + value, 0);
    }
  }

  return total;
}

function listAttributionSnapshotFiles(historyDir: string): string[] {
  if (!existsSync(historyDir)) return [];
  return readdirSync(historyDir)
    .filter((name) => ATTRIBUTION_SNAPSHOT_PATTERN.test(name))
    .sort();
}

function readPreviousAttributionSnapshot(
  repoRoot: string,
  currentFileName: string,
  warnings: string[],
): { fileName: string; snapshot: DownloadAttributionHistorySnapshot } | null {
  const historyDir = getHistoryDir(repoRoot);
  const previousFiles = listAttributionSnapshotFiles(historyDir)
    .filter((name) => name < currentFileName);
  if (previousFiles.length === 0) return null;

  const fileName = previousFiles[previousFiles.length - 1]!;
  const path = resolve(historyDir, fileName);
  try {
    const snapshot = readJsonFile<DownloadAttributionHistorySnapshot>(path);
    if (
      typeof snapshot.total_attributed_fetches !== "number"
      || !Number.isFinite(snapshot.total_attributed_fetches)
    ) {
      warnings.push(`history: invalid total_attributed_fetches in '${fileName}', treating as first-run`);
      return null;
    }
    return { fileName, snapshot };
  } catch {
    warnings.push(`history: failed to parse previous attribution snapshot '${fileName}', treating as first-run`);
    return null;
  }
}

function buildSnapshotForDate(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string,
  previousTotal: number | null,
): DownloadAttributionHistorySnapshot {
  const total = sumLedgerTotalUpToDate(ledger, snapshotDate);
  const daily = ledger.daily[snapshotDate];
  const dailyAssets = sortObjectByKeys(daily?.assets ?? {});
  const dailyTotal = typeof daily?.total === "number" && Number.isFinite(daily.total)
    ? daily.total
    : Object.values(dailyAssets).reduce((sum, value) => sum + value, 0);
  return {
    schema_version: 1,
    snapshot_date: snapshotDate,
    generated_at: generatedAtIso,
    source_ledger_updated_at: ledger.updated_at,
    total_attributed_fetches: total,
    net_attributed_fetches: previousTotal === null ? total : total - previousTotal,
    daily_attributed_fetches: dailyTotal,
    assets_daily: dailyAssets,
  };
}

export function generateDownloadAttributionHistorySnapshot(
  options: GenerateDownloadAttributionHistoryOptions,
): GenerateDownloadAttributionHistoryResult {
  const now = options.now ?? new Date();
  const warnings: string[] = [];
  const snapshotDate = toSnapshotDate(now);
  const fileName = `download_attribution_${snapshotDate}.json`;
  const previous = readPreviousAttributionSnapshot(options.repoRoot, fileName, warnings);
  const ledger = loadDownloadAttributionLedger(options.repoRoot);
  if (!hasDailyBuckets(ledger)) {
    warnings.push(
      "history: attribution ledger has no daily buckets; run backfill-download-attribution with --rebuild-ledger for date-scoped attribution snapshots",
    );
  }

  const snapshot = buildSnapshotForDate(
    ledger,
    snapshotDate,
    now.toISOString(),
    previous?.snapshot.total_attributed_fetches ?? null,
  );

  const historyDir = getHistoryDir(options.repoRoot);
  mkdirSync(historyDir, { recursive: true });
  const path = resolve(historyDir, fileName);
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");

  return {
    snapshotFile: `history/${fileName}`,
    previousSnapshotFile: previous ? `history/${previous.fileName}` : null,
    snapshot,
    warnings,
  };
}

function parseDateFromDownloadSnapshotFile(name: string): string | null {
  const match = name.match(/^snapshot_(\d{4}_\d{2}_\d{2})\.json$/);
  return match ? match[1] : null;
}

function readDownloadSnapshotDates(repoRoot: string): string[] {
  const historyDir = getHistoryDir(repoRoot);
  if (!existsSync(historyDir)) return [];
  return readdirSync(historyDir)
    .map((name) => parseDateFromDownloadSnapshotFile(name))
    .filter((value): value is string => typeof value === "string")
    .sort();
}

export function backfillDownloadAttributionHistorySnapshots(
  options: BackfillDownloadAttributionHistoryOptions,
): BackfillDownloadAttributionHistoryResult {
  const warnings: string[] = [];
  const ledger = loadDownloadAttributionLedger(options.repoRoot);
  if (!hasDailyBuckets(ledger)) {
    warnings.push(
      "history: attribution ledger has no daily buckets; run backfill-download-attribution with --rebuild-ledger for date-scoped attribution snapshots",
    );
  }
  const historyDir = getHistoryDir(options.repoRoot);
  mkdirSync(historyDir, { recursive: true });

  const snapshotDates = readDownloadSnapshotDates(options.repoRoot);
  const updatedFiles: string[] = [];
  let previousTotal: number | null = null;

  for (const snapshotDate of snapshotDates) {
    const fileName = `download_attribution_${snapshotDate}.json`;
    const filePath = resolve(historyDir, fileName);
    const snapshot = buildSnapshotForDate(
      ledger,
      snapshotDate,
      new Date().toISOString(),
      previousTotal,
    );
    previousTotal = snapshot.total_attributed_fetches;

    const nextRaw = `${JSON.stringify(snapshot, null, 2)}\n`;
    const existingRaw = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
    if (existingRaw !== nextRaw) {
      writeFileSync(filePath, nextRaw, "utf-8");
      updatedFiles.push(`history/${fileName}`);
    }
  }

  if (snapshotDates.length === 0) {
    warnings.push("history: no download snapshots found; attribution backfill did nothing");
  }

  return {
    updatedFiles,
    warnings,
  };
}
