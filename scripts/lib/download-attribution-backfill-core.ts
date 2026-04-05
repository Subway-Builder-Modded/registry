import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";
import {
  createDownloadAttributionDelta,
  createEmptyDownloadAttributionLedger,
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  normalizeDownloadAttributionDelta,
  toDownloadAttributionAssetKey,
  writeDownloadAttributionLedger,
  type DownloadAttributionDelta,
} from "./download-attribution.js";
import type { MapManifest } from "./manifests.js";
import { resolveZipUrlForMapSource } from "./map-demand-stats/source-resolution.js";
import { parseGitHubReleaseAssetDownloadUrl } from "./release-resolution.js";
import { resolveRepoRoot } from "./script-runtime.js";

const GITHUB_API_BASE = "https://api.github.com";
const TARGET_WORKFLOW_FILES = [
  "regenerate-registry-analytics.yml",
  "regenerate-downloads-hourly.yml",
] as const;
const FETCH_TIMEOUT_MS = 45_000;
const PROGRESS_HEARTBEAT_RUN_INTERVAL = 10;

interface CliArgs {
  repoRoot: string;
  repoFullName: string;
  token: string;
  lookbackDays: number;
  rebuildLedger: boolean;
}

interface WorkflowRun {
  id: number;
  created_at: string;
  name: string;
  workflowFile: string;
}

interface WorkflowBackfillStats {
  runsScanned: number;
  runsWithLogZip: number;
  runsWithAttribution: number;
  parsedLines: number;
  skippedLines: number;
}

interface GitDeltaBackfillStats {
  commitsScanned: number;
  deltasParsed: number;
  deltasInvalid: number;
}

interface GitDeltaBackfillResult {
  deltas: DownloadAttributionDelta[];
  stats: GitDeltaBackfillStats;
  runIdsWithDelta: Set<number>;
}

export interface DownloadsFetchHit {
  kind: "downloads";
  listingId: string;
  version: string;
  assetName: string;
  generatedAt: string;
  dateKey: string;
}

export interface MapDemandFetchHit {
  kind: "map-demand-stats";
  listingId: string;
  generatedAt: string;
  dateKey: string;
  assetKey?: string;
  zipUrl?: string;
}

export type ParsedAttributionBackfillHit = DownloadsFetchHit | MapDemandFetchHit;

interface IntegritySourceLike {
  repo?: unknown;
  tag?: unknown;
  asset_name?: unknown;
}

interface IntegrityVersionLike {
  source?: IntegritySourceLike;
}

interface IntegrityListingLike {
  versions?: Record<string, IntegrityVersionLike>;
}

interface IntegritySnapshotLike {
  listings?: Record<string, IntegrityListingLike>;
}

interface DemandStatsCacheListingLike {
  source_fingerprint?: unknown;
}

interface DemandStatsCacheLike {
  listings?: Record<string, DemandStatsCacheListingLike>;
}

interface ResolveMapDemandBackfillAssetKeyOptions {
  sourceCommit?: string | null;
  allowLiveFallback?: boolean;
  warnings?: string[];
  gitShowCache?: Map<string, string | null>;
  mapManifestCache?: Map<string, MapManifest | null>;
  demandSourceFingerprintCache?: Map<string, string | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLookbackDays(value: string | undefined): number {
  if (!value) return 90;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --days value '${value}'. Expected a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const repoFullName = (
    process.env.GITHUB_REPOSITORY
    ?? process.env.DOWNLOAD_ATTRIBUTION_REPOSITORY
    ?? "Subway-Builder-Modded/The-Railyard"
  ).trim();
  const token = (
    process.env.GH_DOWNLOADS_TOKEN
    ?? process.env.GITHUB_TOKEN
    ?? ""
  ).trim();

  let lookbackDays = parseLookbackDays(process.env.BACKFILL_LOOKBACK_DAYS);
  let rebuildLedger = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--rebuild-ledger") {
      rebuildLedger = true;
      continue;
    }
    if (arg === "--days") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value after --days");
      }
      lookbackDays = parseLookbackDays(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      lookbackDays = parseLookbackDays(arg.slice("--days=".length));
      continue;
    }
    throw new Error(`Unknown argument '${arg}'. Supported: --days <number>`);
  }

  if (token === "") {
    throw new Error("Missing GH_DOWNLOADS_TOKEN or GITHUB_TOKEN for backfill API access.");
  }
  if (!repoFullName.includes("/")) {
    throw new Error(`Invalid repository '${repoFullName}'. Expected owner/name.`);
  }

  return {
    repoRoot,
    repoFullName,
    token,
    lookbackDays,
    rebuildLedger,
  };
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "the-railyard-download-attribution-backfill",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArrayBuffer(url: string, token: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "the-railyard-download-attribution-backfill",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

function buildLineToAssetKeyIndex(repoRoot: string): Map<string, string> {
  const index = new Map<string, string>();
  const integrityPaths = [
    resolve(repoRoot, "maps", "integrity.json"),
    resolve(repoRoot, "mods", "integrity.json"),
  ];

  for (const path of integrityPaths) {
    if (!existsSync(path)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    } catch {
      continue;
    }
    if (!isObject(raw)) continue;
    addIntegrityMappingsToLineIndex(raw, index);
  }
  return index;
}

function addIntegrityMappingsToLineIndex(
  raw: unknown,
  index: Map<string, string>,
): void {
  if (!isObject(raw)) return;
  const listings = (raw as IntegritySnapshotLike).listings;
  if (!isObject(listings)) return;

  for (const [listingId, listingValue] of Object.entries(listings)) {
    if (!isObject(listingValue)) continue;
    const versions = (listingValue as IntegrityListingLike).versions;
    if (!isObject(versions)) continue;
    for (const [version, versionValue] of Object.entries(versions)) {
      if (!isObject(versionValue)) continue;
      const source = (versionValue as IntegrityVersionLike).source;
      if (!isObject(source)) continue;
      const repo = typeof source.repo === "string" ? source.repo.toLowerCase() : "";
      const tag = typeof source.tag === "string" ? source.tag : "";
      const assetName = typeof source.asset_name === "string" ? source.asset_name : "";
      if (!repo || !tag || !assetName) continue;
      const assetKey = toDownloadAttributionAssetKey(repo, tag, assetName);
      index.set(`${listingId}::${version}::${assetName}`, assetKey);
      index.set(`${listingId}::${version}::${assetName.toLowerCase()}`, assetKey);
    }
  }
}

function toUtcDateKey(isoLike: string): string | null {
  const parsed = Date.parse(isoLike);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "_");
}

function parseDownloadsFetchZipHits(
  logContent: string,
  fallbackTimestamp: string,
): DownloadsFetchHit[] {
  const fallbackDateKey = toUtcDateKey(fallbackTimestamp);
  if (!fallbackDateKey) {
    throw new Error(`Invalid fallback timestamp '${fallbackTimestamp}'`);
  }

  const hits: DownloadsFetchHit[] = [];

  const timestampedRegex = /(\d{4}-\d{2}-\d{2}T[^\s]+Z)[^\n]*?\[downloads\]\s+heartbeat:end fetch-zip listing=([^ ]+) version=([^ ]+) asset=(.+?) status=200\b/g;
  for (;;) {
    const match = timestampedRegex.exec(logContent);
    if (!match) break;
    const generatedAt = match[1] ?? fallbackTimestamp;
    hits.push({
      kind: "downloads",
      listingId: match[2]!,
      version: match[3]!,
      assetName: match[4]!,
      generatedAt,
      dateKey: toUtcDateKey(generatedAt) ?? fallbackDateKey,
    });
  }

  if (hits.length > 0) {
    return hits;
  }

  // Fallback for log payloads that omit the timestamp prefix or normalize whitespace differently.
  const legacyRegex = /\[downloads\]\s+heartbeat:end fetch-zip listing=([^ ]+) version=([^ ]+) asset=(.+?) status=200\b/g;
  for (;;) {
    const match = legacyRegex.exec(logContent);
    if (!match) break;
    hits.push({
      kind: "downloads",
      listingId: match[1]!,
      version: match[2]!,
      assetName: match[3]!,
      generatedAt: fallbackTimestamp,
      dateKey: fallbackDateKey,
    });
  }

  return hits;
}

function parseMapDemandFetchZipHits(
  logContent: string,
  fallbackTimestamp: string,
): MapDemandFetchHit[] {
  const fallbackDateKey = toUtcDateKey(fallbackTimestamp);
  if (!fallbackDateKey) {
    throw new Error(`Invalid fallback timestamp '${fallbackTimestamp}'`);
  }

  const hits: MapDemandFetchHit[] = [];

  const timestampedRegex = /(\d{4}-\d{2}-\d{2}T[^\s]+Z)[^\n]*?\[map-demand-stats\]\s+heartbeat:end fetch-zip listing=([^ ]+)(?: assetKey=([^ ]+))?(?: zipUrl=([^ ]+))? status=200\b/g;
  for (;;) {
    const match = timestampedRegex.exec(logContent);
    if (!match) break;
    const generatedAt = match[1] ?? fallbackTimestamp;
    hits.push({
      kind: "map-demand-stats",
      listingId: match[2]!,
      assetKey: match[3] ? match[3] : undefined,
      zipUrl: match[4] ? match[4] : undefined,
      generatedAt,
      dateKey: toUtcDateKey(generatedAt) ?? fallbackDateKey,
    });
  }

  if (hits.length > 0) {
    return hits;
  }

  const legacyRegex = /\[map-demand-stats\]\s+heartbeat:end fetch-zip listing=([^ ]+)(?: assetKey=([^ ]+))?(?: zipUrl=([^ ]+))? status=200\b/g;
  for (;;) {
    const match = legacyRegex.exec(logContent);
    if (!match) break;
    hits.push({
      kind: "map-demand-stats",
      listingId: match[1]!,
      assetKey: match[2] ? match[2] : undefined,
      zipUrl: match[3] ? match[3] : undefined,
      generatedAt: fallbackTimestamp,
      dateKey: fallbackDateKey,
    });
  }

  return hits;
}

export function parseAttributionBackfillLogHits(
  logContent: string,
  fallbackTimestamp: string,
): ParsedAttributionBackfillHit[] {
  return [
    ...parseDownloadsFetchZipHits(logContent, fallbackTimestamp),
    ...parseMapDemandFetchZipHits(logContent, fallbackTimestamp),
  ];
}

function workflowSourceLabel(workflowFile: string): string {
  return `backfill:${workflowFile.replace(/\.yml$/i, "")}`;
}

function runGitCommand(repoRoot: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

function listCommitShasForPathSince(
  repoRoot: string,
  relativePath: string,
  lookbackDays: number,
): string[] {
  const sinceIso = new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000)).toISOString();
  const output = runGitCommand(
    repoRoot,
    ["log", "--since", sinceIso, "--format=%H", "--", relativePath],
  );
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function readJsonFromCommit(
  repoRoot: string,
  commitSha: string,
  relativePath: string,
): unknown | null {
  const raw = runGitCommand(repoRoot, ["show", `${commitSha}:${relativePath}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function collectDeltasFromGitHistory(
  repoRoot: string,
  lookbackDays: number,
): GitDeltaBackfillResult {
  const deltaPaths = [
    "maps/download-attribution-delta.json",
    "mods/download-attribution-delta.json",
    "maps/demand-attribution-delta.json",
  ] as const;
  const deltas: DownloadAttributionDelta[] = [];
  const seenCommitPath = new Set<string>();
  const stats: GitDeltaBackfillStats = {
    commitsScanned: 0,
    deltasParsed: 0,
    deltasInvalid: 0,
  };
  const runIdsWithDelta = new Set<number>();

  for (const relativePath of deltaPaths) {
    const commits = listCommitShasForPathSince(repoRoot, relativePath, lookbackDays);
    for (const commitSha of commits) {
      const commitPathKey = `${commitSha}:${relativePath}`;
      if (seenCommitPath.has(commitPathKey)) continue;
      seenCommitPath.add(commitPathKey);
      stats.commitsScanned += 1;
      const raw = readJsonFromCommit(repoRoot, commitSha, relativePath);
      const normalized = normalizeDownloadAttributionDelta(raw);
      if (!normalized) {
        stats.deltasInvalid += 1;
        continue;
      }
      const runIdPrefix = normalized.delta_id.split(":", 1)[0];
      if (runIdPrefix) {
        const parsedRunId = Number.parseInt(runIdPrefix, 10);
        if (Number.isFinite(parsedRunId) && parsedRunId > 0) {
          runIdsWithDelta.add(parsedRunId);
        }
      }
      deltas.push(normalized);
      stats.deltasParsed += 1;
    }
  }

  return { deltas, stats, runIdsWithDelta };
}

function resolveSourceCommitAtTime(repoRoot: string, timestampIso: string): string | null {
  return runGitCommand(
    repoRoot,
    ["rev-list", "-1", "--first-parent", `--before=${timestampIso}`, "HEAD"],
  );
}

function readTextAtSource(
  repoRoot: string,
  relativePath: string,
  sourceCommit: string | null | undefined,
  cache?: Map<string, string | null>,
): string | null {
  const sourceKey = sourceCommit?.trim() ? sourceCommit.trim() : "";
  const cacheKey = `${sourceKey || "working"}:${relativePath}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  let content: string | null;
  if (sourceKey) {
    content = runGitCommand(repoRoot, ["show", `${sourceKey}:${relativePath}`]);
  } else {
    const filePath = resolve(repoRoot, ...relativePath.split("/"));
    if (!existsSync(filePath)) {
      content = null;
    } else {
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        content = null;
      }
    }
  }

  cache?.set(cacheKey, content);
  return content;
}

function readJsonAtSource<T>(
  repoRoot: string,
  relativePath: string,
  sourceCommit: string | null | undefined,
  cache?: Map<string, string | null>,
): T | null {
  const text = readTextAtSource(repoRoot, relativePath, sourceCommit, cache);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function buildLineToAssetKeyIndexAtSource(
  repoRoot: string,
  sourceCommit: string | null | undefined,
  gitShowCache?: Map<string, string | null>,
  cache?: Map<string, Map<string, string>>,
): Map<string, string> {
  const sourceKey = sourceCommit?.trim() ? sourceCommit.trim() : "working";
  if (cache?.has(sourceKey)) {
    return cache.get(sourceKey)!;
  }

  const index = new Map<string, string>();
  const mapsIntegrity = readJsonAtSource<unknown>(repoRoot, "maps/integrity.json", sourceCommit, gitShowCache);
  const modsIntegrity = readJsonAtSource<unknown>(repoRoot, "mods/integrity.json", sourceCommit, gitShowCache);
  addIntegrityMappingsToLineIndex(mapsIntegrity, index);
  addIntegrityMappingsToLineIndex(modsIntegrity, index);

  cache?.set(sourceKey, index);
  return index;
}

function parseGithubSourceFingerprint(
  value: string | null | undefined,
): { tag: string; assetName: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("github:")) return null;
  const body = trimmed.slice("github:".length);
  const separator = body.indexOf("|");
  if (separator <= 0 || separator >= body.length - 1) return null;
  const tag = body.slice(0, separator).trim();
  const assetName = body.slice(separator + 1).trim();
  if (!tag || !assetName) return null;
  return { tag, assetName };
}

function getMapManifestAtSource(
  listingId: string,
  repoRoot: string,
  sourceCommit: string | null | undefined,
  gitShowCache?: Map<string, string | null>,
  manifestCache?: Map<string, MapManifest | null>,
): MapManifest | null {
  const sourceKey = sourceCommit?.trim() ? sourceCommit.trim() : "working";
  const cacheKey = `${sourceKey}:${listingId}`;
  if (manifestCache?.has(cacheKey)) {
    return manifestCache.get(cacheKey) ?? null;
  }

  const manifest = readJsonAtSource<MapManifest>(
    repoRoot,
    `maps/${listingId}/manifest.json`,
    sourceCommit,
    gitShowCache,
  );
  const normalized = (
    manifest
    && isObject(manifest)
    && isObject(manifest.update)
    && typeof manifest.update.type === "string"
  )
    ? manifest
    : null;
  manifestCache?.set(cacheKey, normalized);
  return normalized;
}

function getDemandSourceFingerprintAtSource(
  listingId: string,
  repoRoot: string,
  sourceCommit: string | null | undefined,
  gitShowCache?: Map<string, string | null>,
  cache?: Map<string, string | null>,
): string | null {
  const sourceKey = sourceCommit?.trim() ? sourceCommit.trim() : "working";
  const cacheKey = `${sourceKey}:${listingId}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  const demandCache = readJsonAtSource<DemandStatsCacheLike>(
    repoRoot,
    "maps/demand-stats-cache.json",
    sourceCommit,
    gitShowCache,
  );
  let sourceFingerprint: string | null = null;
  if (demandCache && isObject(demandCache.listings)) {
    const listing = demandCache.listings[listingId];
    if (listing && isObject(listing) && typeof listing.source_fingerprint === "string") {
      const trimmed = listing.source_fingerprint.trim();
      sourceFingerprint = trimmed !== "" ? trimmed : null;
    }
  }

  cache?.set(cacheKey, sourceFingerprint);
  return sourceFingerprint;
}

function resolveDeterministicMapDemandAssetKeyFromSourceState(
  listingId: string,
  repoRoot: string,
  sourceCommit: string | null | undefined,
  gitShowCache?: Map<string, string | null>,
  manifestCache?: Map<string, MapManifest | null>,
  demandSourceFingerprintCache?: Map<string, string | null>,
): string | null {
  const manifest = getMapManifestAtSource(
    listingId,
    repoRoot,
    sourceCommit,
    gitShowCache,
    manifestCache,
  );
  if (!manifest) return null;

  const sourceFingerprint = getDemandSourceFingerprintAtSource(
    listingId,
    repoRoot,
    sourceCommit,
    gitShowCache,
    demandSourceFingerprintCache,
  );
  const parsedFingerprint = parseGithubSourceFingerprint(sourceFingerprint);
  if (parsedFingerprint) {
    let repo: string | null = null;
    if (manifest.update.type === "github") {
      repo = manifest.update.repo.toLowerCase();
    } else if (typeof manifest.source === "string") {
      const parsedSource = parseGitHubReleaseAssetDownloadUrl(manifest.source);
      repo = parsedSource?.repo ?? null;
    }
    if (repo) {
      return toDownloadAttributionAssetKey(repo, parsedFingerprint.tag, parsedFingerprint.assetName);
    }
  }

  if (typeof manifest.source === "string") {
    const parsed = parseGitHubReleaseAssetDownloadUrl(manifest.source);
    if (parsed) {
      return toDownloadAttributionAssetKey(parsed.repo, parsed.tag, parsed.assetName);
    }
  }

  return null;
}

export async function resolveMapDemandBackfillAssetKey(
  listingId: string,
  repoRoot: string,
  token: string | undefined,
  fetchImpl: typeof fetch,
  options: ResolveMapDemandBackfillAssetKeyOptions = {},
): Promise<string | null> {
  const {
    sourceCommit,
    allowLiveFallback = true,
    warnings = [],
    gitShowCache,
    mapManifestCache,
    demandSourceFingerprintCache,
  } = options;

  if (sourceCommit?.trim()) {
    const deterministic = resolveDeterministicMapDemandAssetKeyFromSourceState(
      listingId,
      repoRoot,
      sourceCommit,
      gitShowCache,
      mapManifestCache,
      demandSourceFingerprintCache,
    );
    if (deterministic) {
      return deterministic;
    }
  }

  if (!allowLiveFallback) {
    return null;
  }

  const manifest = getMapManifestAtSource(
    listingId,
    repoRoot,
    null,
    gitShowCache,
    mapManifestCache,
  );
  if (!manifest) {
    return null;
  }

  const resolved = await resolveZipUrlForMapSource(
    listingId,
    manifest.source,
    manifest.update,
    fetchImpl,
    token,
    warnings,
  );
  if (!resolved) {
    return null;
  }
  if (resolved.attributionAssetKey) {
    return resolved.attributionAssetKey;
  }
  const parsed = parseGitHubReleaseAssetDownloadUrl(resolved.zipUrl);
  if (!parsed) {
    return null;
  }
  return toDownloadAttributionAssetKey(parsed.repo, parsed.tag, parsed.assetName);
}

async function listWorkflowRunsForFile(
  repoFullName: string,
  token: string,
  cutoffMs: number,
  workflowFile: string,
): Promise<WorkflowRun[]> {
  const runs: WorkflowRun[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}/actions/workflows/${workflowFile}/runs?per_page=100&page=${page}`;
    const payload = await fetchJson<{ workflow_runs?: WorkflowRun[] }>(url, token);
    const pageRuns = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    if (pageRuns.length === 0) break;

    let stop = false;
    for (const run of pageRuns) {
      const createdAt = Date.parse(run.created_at);
      if (Number.isFinite(createdAt) && createdAt < cutoffMs) {
        stop = true;
        continue;
      }
      runs.push({
        ...run,
        workflowFile,
      });
    }
    if (stop) break;
  }
  return runs;
}

async function listWorkflowRuns(
  repoFullName: string,
  token: string,
  cutoffMs: number,
): Promise<WorkflowRun[]> {
  const runs = await Promise.all(
    TARGET_WORKFLOW_FILES.map((workflowFile) => listWorkflowRunsForFile(
      repoFullName,
      token,
      cutoffMs,
      workflowFile,
    )),
  );
  return runs
    .flat()
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

export async function runDownloadAttributionBackfillCli(
  argv = process.argv.slice(2),
  repoRootHint?: string,
): Promise<void> {
  if (repoRootHint) {
    process.env.RAILYARD_REPO_ROOT = repoRootHint;
  }
  const cli = parseArgs(argv);
  const cutoffMs = Date.now() - (cli.lookbackDays * 24 * 60 * 60 * 1000);
  const gitDeltaBackfill = collectDeltasFromGitHistory(cli.repoRoot, cli.lookbackDays);
  const lineIndex = buildLineToAssetKeyIndex(cli.repoRoot);
  const runs = await listWorkflowRuns(cli.repoFullName, cli.token, cutoffMs);
  const runSourceCommitCache = new Map<string, string | null>();
  const gitShowCache = new Map<string, string | null>();
  const mapManifestCache = new Map<string, MapManifest | null>();
  const demandSourceFingerprintCache = new Map<string, string | null>();
  const sourceLineIndexCache = new Map<string, Map<string, string>>();

  const deltas: DownloadAttributionDelta[] = [];
  deltas.push(...gitDeltaBackfill.deltas);
  let parsedRuns = 0;
  let skippedLines = 0;
  let parsedLines = 0;
  let logRunsSkippedByGitDelta = 0;
  const workflowStats = new Map<string, WorkflowBackfillStats>();

  for (const [index, runInfo] of runs.entries()) {
    if (gitDeltaBackfill.runIdsWithDelta.has(runInfo.id)) {
      logRunsSkippedByGitDelta += 1;
      continue;
    }
    const perWorkflow = workflowStats.get(runInfo.workflowFile) ?? {
      runsScanned: 0,
      runsWithLogZip: 0,
      runsWithAttribution: 0,
      parsedLines: 0,
      skippedLines: 0,
    };
    perWorkflow.runsScanned += 1;
    workflowStats.set(runInfo.workflowFile, perWorkflow);

    const logsUrl = `${GITHUB_API_BASE}/repos/${cli.repoFullName}/actions/runs/${runInfo.id}/logs`;
    let logZip: JSZip;
    try {
      const bytes = await fetchArrayBuffer(logsUrl, cli.token);
      logZip = await JSZip.loadAsync(Buffer.from(bytes));
    } catch {
      continue;
    }
    perWorkflow.runsWithLogZip += 1;

    const deltasByDate = new Map<string, DownloadAttributionDelta>();
    let runHasHits = false;

    for (const zipEntry of Object.values(logZip.files)) {
      if (zipEntry.dir) continue;
      let content: string;
      try {
        content = await zipEntry.async("string");
      } catch {
        continue;
      }
      const hits = parseAttributionBackfillLogHits(content, runInfo.created_at);
      for (const hit of hits) {
        parsedLines += 1;
        perWorkflow.parsedLines += 1;
        let assetKey: string | null = null;
        const sourceCommit = runSourceCommitCache.has(runInfo.created_at)
          ? (runSourceCommitCache.get(runInfo.created_at) ?? null)
          : resolveSourceCommitAtTime(cli.repoRoot, runInfo.created_at);
        if (!runSourceCommitCache.has(runInfo.created_at)) {
          runSourceCommitCache.set(runInfo.created_at, sourceCommit);
        }

        if (hit.kind === "downloads") {
          const mapKeyExact = `${hit.listingId}::${hit.version}::${hit.assetName}`;
          const mapKeyLower = `${hit.listingId}::${hit.version}::${hit.assetName.toLowerCase()}`;
          assetKey = lineIndex.get(mapKeyExact) ?? lineIndex.get(mapKeyLower) ?? null;
          if (!assetKey) {
            const sourceLineIndex = buildLineToAssetKeyIndexAtSource(
              cli.repoRoot,
              sourceCommit,
              gitShowCache,
              sourceLineIndexCache,
            );
            assetKey = sourceLineIndex.get(mapKeyExact) ?? sourceLineIndex.get(mapKeyLower) ?? null;
          }
        } else {
          assetKey = hit.assetKey ?? null;
          if (!assetKey && hit.zipUrl) {
            const parsed = parseGitHubReleaseAssetDownloadUrl(hit.zipUrl);
            if (parsed) {
              assetKey = toDownloadAttributionAssetKey(parsed.repo, parsed.tag, parsed.assetName);
            }
          }
          if (!assetKey) {
            assetKey = await resolveMapDemandBackfillAssetKey(
              hit.listingId,
              cli.repoRoot,
              cli.token,
              fetch,
              {
                sourceCommit,
                allowLiveFallback: false,
                gitShowCache,
                mapManifestCache,
                demandSourceFingerprintCache,
              },
            );
          }
        }
        if (!assetKey) {
          skippedLines += 1;
          perWorkflow.skippedLines += 1;
          continue;
        }
        const deltaId = `backfill:run:${runInfo.workflowFile}:${runInfo.id}:${hit.dateKey}`;
        const delta = deltasByDate.get(deltaId)
          ?? createDownloadAttributionDelta(
            workflowSourceLabel(runInfo.workflowFile),
            deltaId,
            hit.generatedAt,
          );
        delta.assets[assetKey] = (delta.assets[assetKey] ?? 0) + 1;
        deltasByDate.set(deltaId, delta);
        runHasHits = true;
      }
    }

    if (runHasHits) {
      parsedRuns += 1;
      perWorkflow.runsWithAttribution += 1;
      deltas.push(...deltasByDate.values());
    }

    const processedRuns = index + 1;
    if (
      processedRuns === runs.length
      || processedRuns % PROGRESS_HEARTBEAT_RUN_INTERVAL === 0
    ) {
      console.log(
        `[download-attribution-backfill] progress runs=${processedRuns}/${runs.length} parsedRuns=${parsedRuns} parsedLines=${parsedLines} skippedLines=${skippedLines} workflow=${runInfo.workflowFile}`,
      );
    }
  }

  const workflowSummaries = [...workflowStats.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([workflowFile, stats]) => (
      `${workflowFile}:runs=${stats.runsScanned},logZips=${stats.runsWithLogZip},runsWithAttribution=${stats.runsWithAttribution},parsedLines=${stats.parsedLines},skippedLines=${stats.skippedLines}`
    ));
  if (cli.rebuildLedger && deltas.length === 0) {
    throw new Error(
      `[download-attribution-backfill] Refusing to overwrite ledger with zero parsed deltas. ${workflowSummaries.join(" | ")}`,
    );
  }

  const ledger = cli.rebuildLedger
    ? createEmptyDownloadAttributionLedger()
    : loadDownloadAttributionLedger(cli.repoRoot);
  const merge = mergeDownloadAttributionDeltas(ledger, deltas);
  writeDownloadAttributionLedger(cli.repoRoot, merge.ledger);

  console.log(
    `[download-attribution-backfill] lookbackDays=${cli.lookbackDays}, runsScanned=${runs.length}, runsWithAttribution=${parsedRuns}, parsedLines=${parsedLines}, skippedLines=${skippedLines}, logRunsSkippedByGitDelta=${logRunsSkippedByGitDelta}, gitDeltaCommits=${gitDeltaBackfill.stats.commitsScanned}, gitDeltasParsed=${gitDeltaBackfill.stats.deltasParsed}, gitDeltasInvalid=${gitDeltaBackfill.stats.deltasInvalid}, addedFetches=${merge.addedFetches}, appliedDeltas=${merge.appliedDeltaIds.length}, skippedDeltas=${merge.skippedDeltaIds.length}`,
  );
  for (const summary of workflowSummaries) {
    console.log(`[download-attribution-backfill] workflow ${summary}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `runs_scanned=${runs.length}`,
      `runs_with_attribution=${parsedRuns}`,
      `parsed_lines=${parsedLines}`,
      `skipped_lines=${skippedLines}`,
      `log_runs_skipped_by_git_delta=${logRunsSkippedByGitDelta}`,
      `git_delta_commits=${gitDeltaBackfill.stats.commitsScanned}`,
      `git_deltas_parsed=${gitDeltaBackfill.stats.deltasParsed}`,
      `git_deltas_invalid=${gitDeltaBackfill.stats.deltasInvalid}`,
      `added_fetches=${merge.addedFetches}`,
      `applied_deltas=${merge.appliedDeltaIds.length}`,
      `skipped_deltas=${merge.skippedDeltaIds.length}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDownloadAttributionBackfillCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
