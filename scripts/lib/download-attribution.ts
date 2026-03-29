import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedReleaseAssetUrl } from "./download-definitions.js";
import { parseGitHubReleaseAssetDownloadUrl } from "./release-resolution.js";

const DOWNLOAD_ATTRIBUTION_SCHEMA_VERSION = 1;
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

export interface DownloadAttributionLedger {
  schema_version: 1;
  updated_at: string;
  assets: Record<string, DownloadAttributionEntry>;
  applied_delta_ids: Record<string, string>;
}

export interface DownloadAttributionDelta {
  schema_version: 1;
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
    schema_version: 1,
    updated_at: nowIso,
    assets: {},
    applied_delta_ids: {},
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
    schema_version: 1,
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
  if (value.schema_version !== DOWNLOAD_ATTRIBUTION_SCHEMA_VERSION) {
    return createEmptyDownloadAttributionLedger(nowIso);
  }

  const assetsRaw = value.assets;
  const appliedRaw = value.applied_delta_ids;
  const assets: Record<string, DownloadAttributionEntry> = {};
  const appliedDeltaIds: Record<string, string> = {};

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

  return {
    schema_version: 1,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    assets: sortObjectByKeys(assets),
    applied_delta_ids: sortObjectByKeys(appliedDeltaIds),
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
    schema_version: 1,
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
): string {
  return `${repo.toLowerCase()}@${tag}/${assetName}`;
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
      addedFetches += count;
      touchedAssetKeys.add(assetKey);
    }
  }

  nextLedger.updated_at = nowIso;
  nextLedger.assets = sortObjectByKeys(nextLedger.assets);
  nextLedger.applied_delta_ids = sortObjectByKeys(nextLedger.applied_delta_ids);

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
