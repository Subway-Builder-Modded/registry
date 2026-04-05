import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedReleaseAssetUrl } from "./download-definitions.js";
import { parseGitHubReleaseAssetDownloadUrl } from "./release-resolution.js";

const DOWNLOAD_ATTRIBUTION_SCHEMA_VERSION = 2;
const DOWNLOAD_ATTRIBUTION_FILE = ["history", "registry-download-attribution.json"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeSource(value: string): string {
  return value.trim() === "" ? "unknown" : value.trim();
}

function sortObjectByKeys<T>(value: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return sorted;
}

export interface DownloadAttributionEntry {
  count: number;
  updated_at: string;
  by_source: Record<string, number>;
}

export interface DownloadAttributionDailyEntry {
  total: number;
  assets: Record<string, number>;
}

export interface DownloadAttributionTimelineEntry {
  total: number;
  assets: Record<string, number>;
}

export interface DownloadAttributionLedger {
  schema_version: 2;
  updated_at: string;
  assets: Record<string, DownloadAttributionEntry>;
  applied_delta_ids: Record<string, string>;
  daily: Record<string, DownloadAttributionDailyEntry>;
  timeline: Record<string, DownloadAttributionTimelineEntry>;
}

export interface DownloadAttributionDelta {
  schema_version: 2;
  delta_id: string;
  source: string;
  generated_at: string;
  assets: Record<string, number>;
}

export interface DownloadCountAdjustment {
  raw: number;
  attributed: number;
  adjusted: number;
  subtracted: number;
  clamped: boolean;
}

export interface MergeDownloadAttributionResult {
  ledger: DownloadAttributionLedger;
  appliedDeltaIds: string[];
  skippedDeltaIds: string[];
  addedFetches: number;
  assetKeysUpdated: number;
}

export interface ParsedAttributionFetchResult {
  ok: boolean;
  key?: string;
  reason?: string;
}

export function getDownloadAttributionPath(repoRoot: string): string {
  return resolve(repoRoot, ...DOWNLOAD_ATTRIBUTION_FILE);
}

export function createEmptyDownloadAttributionLedger(nowIso = new Date().toISOString()): DownloadAttributionLedger {
  return {
    schema_version: 2,
    updated_at: nowIso,
    assets: {},
    applied_delta_ids: {},
    daily: {},
    timeline: {},
  };
}

export function createDownloadAttributionDelta(
  source: string,
  deltaId?: string,
  generatedAt = new Date().toISOString(),
): DownloadAttributionDelta {
  const normalizedSource = normalizeSource(source);
  const normalizedDeltaId = (
    typeof deltaId === "string"
    && deltaId.trim() !== ""
  )
    ? deltaId.trim()
    : `${normalizedSource}:${generatedAt}`;
  return {
    schema_version: 2,
    delta_id: normalizedDeltaId,
    source: normalizedSource,
    generated_at: generatedAt,
    assets: {},
  };
}

export function normalizeDownloadAttributionLedger(
  value: unknown,
  nowIso = new Date().toISOString(),
): DownloadAttributionLedger {
  if (!isObject(value)) {
    return createEmptyDownloadAttributionLedger(nowIso);
  }
  const schemaVersion = value.schema_version;
  if (schemaVersion !== 1 && schemaVersion !== DOWNLOAD_ATTRIBUTION_SCHEMA_VERSION) {
    return createEmptyDownloadAttributionLedger(nowIso);
  }

  const assetsRaw = value.assets;
  const appliedRaw = value.applied_delta_ids;
  const dailyRaw = value.daily;
  const timelineRaw = value.timeline;
  const assets: Record<string, DownloadAttributionEntry> = {};
  const appliedDeltaIds: Record<string, string> = {};
  const daily: Record<string, DownloadAttributionDailyEntry> = {};
  const timeline: Record<string, DownloadAttributionTimelineEntry> = {};

  if (isObject(assetsRaw)) {
    for (const [assetKey, rawEntry] of Object.entries(assetsRaw)) {
      if (!isObject(rawEntry)) continue;
      const count = toFiniteNonNegativeNumber(rawEntry.count);
      const updatedAt = typeof rawEntry.updated_at === "string" && rawEntry.updated_at.trim() !== ""
        ? rawEntry.updated_at
        : nowIso;
      if (count === null) continue;

      const bySource: Record<string, number> = {};
      if (isObject(rawEntry.by_source)) {
        for (const [sourceKey, sourceCount] of Object.entries(rawEntry.by_source)) {
          const parsedSourceCount = toFiniteNonNegativeNumber(sourceCount);
          if (parsedSourceCount === null) continue;
          bySource[sourceKey] = parsedSourceCount;
        }
      }

      assets[assetKey] = {
        count,
        updated_at: updatedAt,
        by_source: sortObjectByKeys(bySource),
      };
    }
  }

  if (isObject(appliedRaw)) {
    for (const [deltaId, appliedAt] of Object.entries(appliedRaw)) {
      if (typeof appliedAt !== "string" || appliedAt.trim() === "") continue;
      appliedDeltaIds[deltaId] = appliedAt;
    }
  }

  if (isObject(dailyRaw)) {
    for (const [dateKey, dateValue] of Object.entries(dailyRaw)) {
      if (!isObject(dateValue)) continue;
      const total = toFiniteNonNegativeNumber(dateValue.total);
      if (total === null) continue;
      const dailyAssets: Record<string, number> = {};
      if (isObject(dateValue.assets)) {
        for (const [assetKey, rawCount] of Object.entries(dateValue.assets)) {
          const parsedCount = toFiniteNonNegativeNumber(rawCount);
          if (parsedCount === null || parsedCount === 0) continue;
          dailyAssets[assetKey] = parsedCount;
        }
      }
      daily[dateKey] = {
        total,
        assets: sortObjectByKeys(dailyAssets),
      };
    }
  }

  if (isObject(timelineRaw)) {
    for (const [timeKey, timeValue] of Object.entries(timelineRaw)) {
      if (!isObject(timeValue)) continue;
      const total = toFiniteNonNegativeNumber(timeValue.total);
      if (total === null) continue;
      const timelineAssets: Record<string, number> = {};
      if (isObject(timeValue.assets)) {
        for (const [assetKey, rawCount] of Object.entries(timeValue.assets)) {
          const parsedCount = toFiniteNonNegativeNumber(rawCount);
          if (parsedCount === null || parsedCount === 0) continue;
          timelineAssets[assetKey] = parsedCount;
        }
      }
      timeline[timeKey] = {
        total,
        assets: sortObjectByKeys(timelineAssets),
      };
    }
  }

  return {
    schema_version: 2,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    assets: sortObjectByKeys(assets),
    applied_delta_ids: sortObjectByKeys(appliedDeltaIds),
    daily: sortObjectByKeys(daily),
    timeline: sortObjectByKeys(timeline),
  };
}

export function normalizeDownloadAttributionDelta(
  value: unknown,
): DownloadAttributionDelta | null {
  if (!isObject(value)) return null;
  if (value.schema_version !== DOWNLOAD_ATTRIBUTION_SCHEMA_VERSION) return null;
  if (typeof value.delta_id !== "string" || value.delta_id.trim() === "") return null;
  if (typeof value.source !== "string" || value.source.trim() === "") return null;
  if (typeof value.generated_at !== "string" || value.generated_at.trim() === "") return null;
  if (!isObject(value.assets)) return null;

  const assets: Record<string, number> = {};
  for (const [assetKey, count] of Object.entries(value.assets)) {
    const parsedCount = toFiniteNonNegativeNumber(count);
    if (parsedCount === null || parsedCount === 0) continue;
    assets[assetKey] = parsedCount;
  }

  return {
    schema_version: 2,
    delta_id: value.delta_id,
    source: value.source,
    generated_at: value.generated_at,
    assets: sortObjectByKeys(assets),
  };
}

export function loadDownloadAttributionLedger(repoRoot: string): DownloadAttributionLedger {
  const path = getDownloadAttributionPath(repoRoot);
  if (!existsSync(path)) {
    return createEmptyDownloadAttributionLedger();
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return normalizeDownloadAttributionLedger(raw);
  } catch {
    return createEmptyDownloadAttributionLedger();
  }
}

export function writeDownloadAttributionLedger(repoRoot: string, ledger: DownloadAttributionLedger): void {
  const path = getDownloadAttributionPath(repoRoot);
  const normalized = normalizeDownloadAttributionLedger(ledger);
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

export function toDownloadAttributionAssetKey(
  repo: string,
  tag: string,
  assetName: string,
  assetIdentity?: string | null,
): string {
  const base = `${repo.toLowerCase()}@${tag}/${assetName}`;
  if (typeof assetIdentity !== "string" || assetIdentity.trim() === "") {
    return base;
  }
  return `${base}#${assetIdentity.trim()}`;
}

export function toDownloadAttributionAssetKeyFromParsed(parsed: ParsedReleaseAssetUrl): string {
  return toDownloadAttributionAssetKey(parsed.repo, parsed.tag, parsed.assetName);
}

export function getAttributedCountForAssetKey(
  ledger: DownloadAttributionLedger,
  delta: DownloadAttributionDelta | undefined,
  assetKey: string,
): number {
  const persisted = ledger.assets[assetKey]?.count ?? 0;
  const pending = delta?.assets[assetKey] ?? 0;
  return persisted + pending;
}

export function getAttributedCountForParsedAsset(
  ledger: DownloadAttributionLedger,
  delta: DownloadAttributionDelta | undefined,
  parsed: ParsedReleaseAssetUrl,
): number {
  return getAttributedCountForAssetKey(
    ledger,
    delta,
    toDownloadAttributionAssetKeyFromParsed(parsed),
  );
}

export function adjustDownloadCount(
  raw: number,
  attributed: number,
): DownloadCountAdjustment {
  const normalizedRaw = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  const normalizedAttributed = Number.isFinite(attributed) && attributed >= 0 ? attributed : 0;
  const adjusted = Math.max(0, normalizedRaw - normalizedAttributed);
  return {
    raw: normalizedRaw,
    attributed: normalizedAttributed,
    adjusted,
    subtracted: normalizedRaw - adjusted,
    clamped: normalizedRaw > 0 && adjusted === 0 && normalizedAttributed > normalizedRaw,
  };
}

function toUtcDateKeyFromIso(isoLike: string): string | null {
  const parsed = Date.parse(isoLike);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "_");
}

function hasTimelineEntries(ledger: DownloadAttributionLedger): boolean {
  return Object.keys(ledger.timeline).length > 0;
}

export function forEachLedgerAssetCountUpToCutoff(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string | null | undefined,
  visit: (assetKey: string, count: number) => void,
): void {
  const cutoffIso = generatedAtIso?.trim() ? generatedAtIso : null;
  const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
  if (hasTimelineEntries(ledger) && Number.isFinite(cutoffMs)) {
    for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
      const entryMs = Date.parse(timeKey);
      if (!Number.isFinite(entryMs) || entryMs > cutoffMs) continue;
      for (const [assetKey, count] of Object.entries(entry.assets)) {
        visit(assetKey, count);
      }
    }
    return;
  }

  for (const [dateKey, entry] of Object.entries(ledger.daily)) {
    if (dateKey > snapshotDate) continue;
    for (const [assetKey, count] of Object.entries(entry.assets)) {
      visit(assetKey, count);
    }
  }
}

export function sumLedgerTotalUpToCutoff(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string | null | undefined,
): number {
  const cutoffIso = generatedAtIso?.trim() ? generatedAtIso : null;
  const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
  if (hasTimelineEntries(ledger) && Number.isFinite(cutoffMs)) {
    let total = 0;
    for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
      const entryMs = Date.parse(timeKey);
      if (!Number.isFinite(entryMs) || entryMs > cutoffMs) continue;
      total += entry.total;
    }
    return total;
  }

  let total = 0;
  for (const [dateKey, entry] of Object.entries(ledger.daily)) {
    if (dateKey > snapshotDate) continue;
    if (typeof entry.total === "number" && Number.isFinite(entry.total)) {
      total += entry.total;
      continue;
    }
    total += Object.values(entry.assets).reduce((sum, value) => sum + value, 0);
  }
  return total;
}

export function getLedgerAssetsForDateCutoff(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string | null | undefined,
): Record<string, number> {
  const cutoffIso = generatedAtIso?.trim() ? generatedAtIso : null;
  const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
  if (hasTimelineEntries(ledger) && Number.isFinite(cutoffMs)) {
    const assets: Record<string, number> = {};
    for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
      const entryMs = Date.parse(timeKey);
      if (!Number.isFinite(entryMs) || entryMs > cutoffMs) continue;
      if (toUtcDateKeyFromIso(timeKey) !== snapshotDate) continue;
      for (const [assetKey, count] of Object.entries(entry.assets)) {
        assets[assetKey] = (assets[assetKey] ?? 0) + count;
      }
    }
    return sortObjectByKeys(assets);
  }

  return sortObjectByKeys(ledger.daily[snapshotDate]?.assets ?? {});
}

export function sumLedgerDateTotalUpToCutoff(
  ledger: DownloadAttributionLedger,
  snapshotDate: string,
  generatedAtIso: string | null | undefined,
): number {
  const cutoffIso = generatedAtIso?.trim() ? generatedAtIso : null;
  const cutoffMs = cutoffIso ? Date.parse(cutoffIso) : Number.NaN;
  if (hasTimelineEntries(ledger) && Number.isFinite(cutoffMs)) {
    let total = 0;
    for (const [timeKey, entry] of Object.entries(ledger.timeline)) {
      const entryMs = Date.parse(timeKey);
      if (!Number.isFinite(entryMs) || entryMs > cutoffMs) continue;
      if (toUtcDateKeyFromIso(timeKey) !== snapshotDate) continue;
      total += entry.total;
    }
    return total;
  }

  const entry = ledger.daily[snapshotDate];
  if (typeof entry?.total === "number" && Number.isFinite(entry.total)) {
    return entry.total;
  }
  return Object.values(entry?.assets ?? {}).reduce((sum, value) => sum + value, 0);
}

export function recordDownloadAttributionFetchByAssetKey(
  delta: DownloadAttributionDelta,
  assetKey: string,
): void {
  if (!assetKey || assetKey.trim() === "") return;
  const current = delta.assets[assetKey] ?? 0;
  delta.assets[assetKey] = current + 1;
}

export function recordDownloadAttributionFetchByParsed(
  delta: DownloadAttributionDelta,
  parsed: ParsedReleaseAssetUrl,
): string {
  const key = toDownloadAttributionAssetKeyFromParsed(parsed);
  recordDownloadAttributionFetchByAssetKey(delta, key);
  return key;
}

export function recordDownloadAttributionFetchByUrl(
  delta: DownloadAttributionDelta,
  downloadUrl: string,
): ParsedAttributionFetchResult {
  const parsed = parseGitHubReleaseAssetDownloadUrl(downloadUrl);
  if (!parsed) {
    return {
      ok: false,
      reason: "download URL is not a GitHub release asset URL",
    };
  }
  const key = recordDownloadAttributionFetchByParsed(delta, parsed);
  return { ok: true, key };
}

export function sumDownloadAttributionDeltaFetches(delta: DownloadAttributionDelta): number {
  let total = 0;
  for (const count of Object.values(delta.assets)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) {
      total += count;
    }
  }
  return total;
}

export function mergeDownloadAttributionDeltas(
  ledger: DownloadAttributionLedger,
  deltas: DownloadAttributionDelta[],
  nowIso = new Date().toISOString(),
): MergeDownloadAttributionResult {
  const nextLedger = normalizeDownloadAttributionLedger(ledger, nowIso);
  const appliedDeltaIds: string[] = [];
  const skippedDeltaIds: string[] = [];
  let addedFetches = 0;
  const touchedAssetKeys = new Set<string>();

  for (const delta of deltas) {
    const normalizedDelta = normalizeDownloadAttributionDelta(delta);
    if (!normalizedDelta) continue;
    const parsedGeneratedAt = Date.parse(normalizedDelta.generated_at);
    const deltaDateKey = Number.isFinite(parsedGeneratedAt)
      ? new Date(parsedGeneratedAt).toISOString().slice(0, 10).replaceAll("-", "_")
      : nowIso.slice(0, 10).replaceAll("-", "_");
    if (nextLedger.applied_delta_ids[normalizedDelta.delta_id]) {
      skippedDeltaIds.push(normalizedDelta.delta_id);
      continue;
    }
    nextLedger.applied_delta_ids[normalizedDelta.delta_id] = nowIso;
    appliedDeltaIds.push(normalizedDelta.delta_id);

    for (const [assetKey, count] of Object.entries(normalizedDelta.assets)) {
      if (!Number.isFinite(count) || count <= 0) continue;
      const existing = nextLedger.assets[assetKey] ?? {
        count: 0,
        updated_at: nowIso,
        by_source: {},
      };
      existing.count += count;
      existing.updated_at = nowIso;
      existing.by_source[normalizedDelta.source] = (
        existing.by_source[normalizedDelta.source] ?? 0
      ) + count;
      nextLedger.assets[assetKey] = {
        ...existing,
        by_source: sortObjectByKeys(existing.by_source),
      };
      const dailyEntry = nextLedger.daily[deltaDateKey] ?? { total: 0, assets: {} };
      dailyEntry.total += count;
      dailyEntry.assets[assetKey] = (dailyEntry.assets[assetKey] ?? 0) + count;
      nextLedger.daily[deltaDateKey] = {
        total: dailyEntry.total,
        assets: sortObjectByKeys(dailyEntry.assets),
      };
      const timelineEntry = nextLedger.timeline[normalizedDelta.generated_at] ?? { total: 0, assets: {} };
      timelineEntry.total += count;
      timelineEntry.assets[assetKey] = (timelineEntry.assets[assetKey] ?? 0) + count;
      nextLedger.timeline[normalizedDelta.generated_at] = {
        total: timelineEntry.total,
        assets: sortObjectByKeys(timelineEntry.assets),
      };
      addedFetches += count;
      touchedAssetKeys.add(assetKey);
    }
  }

  nextLedger.updated_at = nowIso;
  nextLedger.assets = sortObjectByKeys(nextLedger.assets);
  nextLedger.applied_delta_ids = sortObjectByKeys(nextLedger.applied_delta_ids);
  nextLedger.daily = sortObjectByKeys(nextLedger.daily);
  nextLedger.timeline = sortObjectByKeys(nextLedger.timeline);

  return {
    ledger: nextLedger,
    appliedDeltaIds,
    skippedDeltaIds,
    addedFetches,
    assetKeysUpdated: touchedAssetKeys.size,
  };
}

export function readDownloadAttributionDeltaFile(path: string): DownloadAttributionDelta | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return normalizeDownloadAttributionDelta(raw);
  } catch {
    return null;
  }
}

export function writeDownloadAttributionDeltaFile(path: string, delta: DownloadAttributionDelta): void {
  const normalized = normalizeDownloadAttributionDelta(delta);
  if (!normalized) {
    throw new Error(`Invalid download attribution delta payload for path '${path}'`);
  }
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}
