import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getLedgerAssetsForDateCutoff,
  loadDownloadAttributionLedger,
  sumLedgerDateTotalUpToCutoff,
  sumLedgerTotalUpToCutoff,
  type DownloadAttributionLedger,
} from "./download-attribution.js";
import { readJsonFile, sortObjectByKeys, writeJsonFile } from "./json-utils.js";
import { toSnapshotDate, toCanonicalHistoryCutoffIso, getHistoryDir } from "./history-utils.js";
import type { DownloadAttributionHistorySnapshot } from "@subway-builder-modded/registry-schemas";

export type { DownloadAttributionHistorySnapshot } from "@subway-builder-modded/registry-schemas";

const ATTRIBUTION_SNAPSHOT_PATTERN = /^download_attribution_(\d{4}_\d{2}_\d{2})\.json$/;

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

interface DownloadSnapshotMeta {
  snapshotDate: string;
  generatedAtIso: string;
}

function hasDailyBuckets(ledger: DownloadAttributionLedger): boolean {
  return Object.keys(ledger.daily).length > 0;
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
  clampToPreviousTotal: boolean,
  warnings?: string[],
): DownloadAttributionHistorySnapshot {
  const computedTotal = sumLedgerTotalUpToCutoff(ledger, snapshotDate, generatedAtIso);
  const total = (
    clampToPreviousTotal
    && previousTotal !== null
    && computedTotal < previousTotal
  )
    ? previousTotal
    : computedTotal;
  if (warnings && clampToPreviousTotal && previousTotal !== null && computedTotal < previousTotal) {
    warnings.push(
      `history: clamped attribution total to monotonic value for '${snapshotDate}' (${computedTotal} -> ${previousTotal})`,
    );
  }
  const dailyAssets = getLedgerAssetsForDateCutoff(ledger, snapshotDate, generatedAtIso);
  const dailyTotal = sumLedgerDateTotalUpToCutoff(ledger, snapshotDate, generatedAtIso);
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

function buildStrictBackfillSnapshotForDate(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string,
  previousTotal: number | null,
): DownloadAttributionHistorySnapshot {
  const computedTotal = sumLedgerTotalUpToCutoff(ledger, snapshotDate, generatedAtIso);
  const dailyAssets = getLedgerAssetsForDateCutoff(ledger, snapshotDate, generatedAtIso);
  const dailyTotal = sumLedgerDateTotalUpToCutoff(ledger, snapshotDate, generatedAtIso);
  return {
    schema_version: 1,
    snapshot_date: snapshotDate,
    generated_at: generatedAtIso,
    source_ledger_updated_at: ledger.updated_at,
    total_attributed_fetches: computedTotal,
    net_attributed_fetches: previousTotal === null ? computedTotal : computedTotal - previousTotal,
    daily_attributed_fetches: dailyTotal,
    assets_daily: dailyAssets,
  };
}

export function buildAttributionHistorySnapshot(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string,
  previousTotal: number | null,
  options?: {
    clampToPreviousTotal?: boolean;
    warnings?: string[];
  },
): DownloadAttributionHistorySnapshot {
  if (options?.clampToPreviousTotal === false) {
    return buildStrictBackfillSnapshotForDate(
      ledger,
      snapshotDate,
      generatedAtIso,
      previousTotal,
    );
  }
  return buildSnapshotForDate(
    ledger,
    snapshotDate,
    generatedAtIso,
    previousTotal,
    true,
    options?.warnings,
  );
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

  const snapshot = buildAttributionHistorySnapshot(
    ledger,
    snapshotDate,
    now.toISOString(),
    previous?.snapshot.total_attributed_fetches ?? null,
    {
      clampToPreviousTotal: true,
      warnings,
    },
  );

  const historyDir = getHistoryDir(options.repoRoot);
  mkdirSync(historyDir, { recursive: true });
  const path = resolve(historyDir, fileName);
  writeJsonFile(path, snapshot);

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

function readDownloadSnapshotMetas(repoRoot: string): DownloadSnapshotMeta[] {
  const historyDir = getHistoryDir(repoRoot);
  if (!existsSync(historyDir)) return [];
  const metas: DownloadSnapshotMeta[] = [];
  for (const name of readdirSync(historyDir).sort()) {
    const snapshotDate = parseDateFromDownloadSnapshotFile(name);
    if (!snapshotDate) continue;
    metas.push({ snapshotDate, generatedAtIso: toCanonicalHistoryCutoffIso(snapshotDate) });
  }
  return metas;
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

  const snapshotMetas = readDownloadSnapshotMetas(options.repoRoot);
  const updatedFiles: string[] = [];
  let previousTotal: number | null = null;

  for (const snapshotMeta of snapshotMetas) {
    const snapshotDate = snapshotMeta.snapshotDate;
    const fileName = `download_attribution_${snapshotDate}.json`;
    const filePath = resolve(historyDir, fileName);
    const snapshot = buildAttributionHistorySnapshot(
      ledger,
      snapshotDate,
      snapshotMeta.generatedAtIso,
      previousTotal,
      {
        // Backfill should strictly reflect the current reconstructed ledger
        // so stricter retroactive filtering can lower inflated historical totals.
        clampToPreviousTotal: false,
        warnings,
      },
    );
    previousTotal = snapshot.total_attributed_fetches;

    const nextRaw = `${JSON.stringify(snapshot, null, 2)}\n`;
    const existingRaw = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
    if (existingRaw !== nextRaw) {
      writeFileSync(filePath, nextRaw, "utf-8");
      updatedFiles.push(`history/${fileName}`);
    }
  }

  if (snapshotMetas.length === 0) {
    warnings.push("history: no download snapshots found; attribution backfill did nothing");
  }

  return {
    updatedFiles,
    warnings,
  };
}
