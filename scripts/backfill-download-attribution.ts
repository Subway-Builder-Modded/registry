import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import {
  createDownloadAttributionDelta,
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  toDownloadAttributionAssetKey,
  writeDownloadAttributionLedger,
  type DownloadAttributionDelta,
} from "./lib/download-attribution.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

const GITHUB_API_BASE = "https://api.github.com";
const TARGET_WORKFLOW_FILE = "regenerate-registry-analytics.yml";
const FETCH_TIMEOUT_MS = 45_000;

interface CliArgs {
  repoRoot: string;
  repoFullName: string;
  token: string;
  lookbackDays: number;
}

interface WorkflowRun {
  id: number;
  created_at: string;
  name: string;
}

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
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
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
    const listings = (raw as IntegritySnapshotLike).listings;
    if (!isObject(listings)) continue;

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
  return index;
}

function parseFetchZipHits(logContent: string): Array<{ listingId: string; version: string; assetName: string }> {
  const regex = /\[downloads\] heartbeat:end fetch-zip listing=([^ ]+) version=([^ ]+) asset=(.+?) status=200\b/g;
  const hits: Array<{ listingId: string; version: string; assetName: string }> = [];
  for (;;) {
    const match = regex.exec(logContent);
    if (!match) break;
    hits.push({
      listingId: match[1],
      version: match[2],
      assetName: match[3],
    });
  }
  return hits;
}

async function listWorkflowRuns(
  repoFullName: string,
  token: string,
  cutoffMs: number,
): Promise<WorkflowRun[]> {
  const runs: WorkflowRun[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `${GITHUB_API_BASE}/repos/${repoFullName}/actions/workflows/${TARGET_WORKFLOW_FILE}/runs?per_page=100&page=${page}`;
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
      runs.push(run);
    }
    if (stop) break;
  }
  return runs;
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const cutoffMs = Date.now() - (cli.lookbackDays * 24 * 60 * 60 * 1000);
  const lineIndex = buildLineToAssetKeyIndex(cli.repoRoot);
  const runs = await listWorkflowRuns(cli.repoFullName, cli.token, cutoffMs);

  const deltas: DownloadAttributionDelta[] = [];
  let parsedRuns = 0;
  let skippedLines = 0;
  let parsedLines = 0;

  for (const runInfo of runs) {
    const logsUrl = `${GITHUB_API_BASE}/repos/${cli.repoFullName}/actions/runs/${runInfo.id}/logs`;
    let logZip: JSZip;
    try {
      const bytes = await fetchArrayBuffer(logsUrl, cli.token);
      logZip = await JSZip.loadAsync(Buffer.from(bytes));
    } catch {
      continue;
    }

    const delta = createDownloadAttributionDelta(
      "backfill:regenerate-registry-analytics",
      `backfill:run:${runInfo.id}`,
      new Date().toISOString(),
    );
    let runHasHits = false;

    for (const zipEntry of Object.values(logZip.files)) {
      if (zipEntry.dir) continue;
      let content: string;
      try {
        content = await zipEntry.async("string");
      } catch {
        continue;
      }
      const hits = parseFetchZipHits(content);
      for (const hit of hits) {
        parsedLines += 1;
        const mapKeyExact = `${hit.listingId}::${hit.version}::${hit.assetName}`;
        const mapKeyLower = `${hit.listingId}::${hit.version}::${hit.assetName.toLowerCase()}`;
        const assetKey = lineIndex.get(mapKeyExact) ?? lineIndex.get(mapKeyLower);
        if (!assetKey) {
          skippedLines += 1;
          continue;
        }
        delta.assets[assetKey] = (delta.assets[assetKey] ?? 0) + 1;
        runHasHits = true;
      }
    }

    if (runHasHits) {
      parsedRuns += 1;
      deltas.push(delta);
    }
  }

  const ledger = loadDownloadAttributionLedger(cli.repoRoot);
  const merge = mergeDownloadAttributionDeltas(ledger, deltas);
  writeDownloadAttributionLedger(cli.repoRoot, merge.ledger);

  console.log(
    `[download-attribution-backfill] lookbackDays=${cli.lookbackDays}, runsScanned=${runs.length}, runsWithAttribution=${parsedRuns}, parsedLines=${parsedLines}, skippedLines=${skippedLines}, addedFetches=${merge.addedFetches}, appliedDeltas=${merge.appliedDeltaIds.length}, skippedDeltas=${merge.skippedDeltaIds.length}`,
  );

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `runs_scanned=${runs.length}`,
      `runs_with_attribution=${parsedRuns}`,
      `parsed_lines=${parsedLines}`,
      `skipped_lines=${skippedLines}`,
      `added_fetches=${merge.addedFetches}`,
      `applied_deltas=${merge.appliedDeltaIds.length}`,
      `skipped_deltas=${merge.skippedDeltaIds.length}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
