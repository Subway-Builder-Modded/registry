import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { parseAttributionBackfillLogHits } from "./lib/download-attribution-backfill-core.js";
import type { DownloadAttributionLedger } from "./lib/download-attribution.js";
import type { IntegrityOutput } from "./lib/integrity.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

const TARGET_WORKFLOW_FILES = [
  "regenerate-registry-analytics.yml",
  "regenerate-downloads-hourly.yml",
  "regenerate-map-demand-stats.yml",
] as const;

interface WorkflowRun {
  id: number;
  created_at: string;
  workflowFile: string;
}

interface CliArgs {
  repoRoot: string;
  repoFullName: string;
  token: string;
  days: number;
  maxRuns: number;
  maps: string[];
  compareRef?: string;
  topLoss: number;
  outputPath?: string;
}

interface ListingScanStats {
  log_download_hits: number;
  log_demand_hits: number;
  versions: Record<string, number>;
}

function parseIntArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric argument '${value}'`);
  }
  return parsed;
}

function getArgValue(args: string[], name: string): string | undefined {
  const key = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(key)) return arg.slice(key.length);
  }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}`) {
      return args[i + 1];
    }
  }
  return undefined;
}

function parseMaps(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function parseArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const repoFullName = (
    getArgValue(argv, "repo")
    ?? process.env.GITHUB_REPOSITORY
    ?? "Subway-Builder-Modded/The-Railyard"
  ).trim();
  const token = (
    getArgValue(argv, "token")
    ?? process.env.GH_DOWNLOADS_TOKEN
    ?? process.env.GITHUB_TOKEN
    ?? ""
  ).trim();
  if (token === "") {
    throw new Error("Missing token. Provide --token or GH_DOWNLOADS_TOKEN/GITHUB_TOKEN.");
  }

  const days = parseIntArg(getArgValue(argv, "days"), 90);
  const maxRuns = parseIntArg(getArgValue(argv, "max-runs"), 120);
  const maps = parseMaps(getArgValue(argv, "maps"));
  const compareRef = getArgValue(argv, "compare-ref")?.trim() || undefined;
  const topLoss = parseIntArg(getArgValue(argv, "top-loss"), 12);
  const outputPath = getArgValue(argv, "output")?.trim() || undefined;

  return {
    repoRoot,
    repoFullName,
    token,
    days,
    maxRuns,
    maps,
    compareRef,
    topLoss,
    outputPath,
  };
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "railyard-attribution-spotcheck",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return await response.json() as T;
}

async function fetchArrayBuffer(url: string, token: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "railyard-attribution-spotcheck",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return await response.arrayBuffer();
}

function normalizeAssetBaseKey(assetKey: string): string {
  const trimmed = assetKey.trim();
  const hashIndex = trimmed.indexOf("#");
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const atIndex = base.indexOf("@");
  const slashIndex = base.indexOf("/", atIndex + 1);
  if (atIndex <= 0 || slashIndex <= atIndex + 1 || slashIndex >= base.length - 1) {
    return base.toLowerCase();
  }
  const repo = base.slice(0, atIndex).toLowerCase();
  const tag = base.slice(atIndex + 1, slashIndex);
  const assetName = base.slice(slashIndex + 1).toLowerCase();
  return `${repo}@${tag}/${assetName}`;
}

function readLedgerAtPath(path: string): DownloadAttributionLedger {
  return JSON.parse(readFileSync(path, "utf-8")) as DownloadAttributionLedger;
}

function readLedgerAtRef(repoRoot: string, ref: string): DownloadAttributionLedger {
  const raw = execFileSync(
    "git",
    ["show", `${ref}:history/registry-download-attribution.json`],
    { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as DownloadAttributionLedger;
}

function buildMapAssetKeyToListing(repoRoot: string): Map<string, string> {
  const integrity = JSON.parse(
    readFileSync(resolve(repoRoot, "maps", "integrity.json"), "utf-8"),
  ) as IntegrityOutput;
  const mapByAsset = new Map<string, string>();
  for (const [listingId, listing] of Object.entries(integrity.listings)) {
    for (const version of Object.values(listing.versions)) {
      const source = version.source;
      if (!source.repo || !source.tag || !source.asset_name) continue;
      const key = normalizeAssetBaseKey(`${source.repo}@${source.tag}/${source.asset_name}`);
      if (!mapByAsset.has(key)) {
        mapByAsset.set(key, listingId);
      }
    }
  }
  return mapByAsset;
}

function aggregateLedgerByListing(
  ledger: DownloadAttributionLedger,
  assetToListing: Map<string, string>,
): Map<string, number> {
  const byListing = new Map<string, number>();
  for (const [assetKey, entry] of Object.entries(ledger.assets ?? {})) {
    const baseKey = normalizeAssetBaseKey(assetKey);
    const listingId = assetToListing.get(baseKey);
    if (!listingId) continue;
    byListing.set(listingId, (byListing.get(listingId) ?? 0) + (entry.count ?? 0));
  }
  return byListing;
}

async function listWorkflowRuns(
  repoFullName: string,
  token: string,
  cutoffMs: number,
  maxRuns: number,
): Promise<WorkflowRun[]> {
  const runs: WorkflowRun[] = [];
  for (const workflowFile of TARGET_WORKFLOW_FILES) {
    let page = 1;
    while (runs.length < maxRuns) {
      const url = `https://api.github.com/repos/${repoFullName}/actions/workflows/${workflowFile}/runs?per_page=100&page=${page}`;
      const payload = await fetchJson<{ workflow_runs?: Array<{ id: number; created_at: string }> }>(url, token);
      const pageRuns = payload.workflow_runs ?? [];
      if (pageRuns.length === 0) break;
      let shouldStop = false;
      for (const run of pageRuns) {
        const createdAt = Date.parse(run.created_at);
        if (Number.isFinite(createdAt) && createdAt < cutoffMs) {
          shouldStop = true;
          break;
        }
        runs.push({
          id: run.id,
          created_at: run.created_at,
          workflowFile,
        });
        if (runs.length >= maxRuns) break;
      }
      if (shouldStop || runs.length >= maxRuns) break;
      page += 1;
    }
  }
  return runs
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, maxRuns);
}

function toListingRows(
  selectedMaps: string[],
  scanStatsByListing: Map<string, ListingScanStats>,
  currentAttributionByListing: Map<string, number>,
  previousAttributionByListing: Map<string, number> | null,
): Array<Record<string, unknown>> {
  return selectedMaps.map((listingId) => {
    const scan = scanStatsByListing.get(listingId) ?? {
      log_download_hits: 0,
      log_demand_hits: 0,
      versions: {},
    };
    const current = currentAttributionByListing.get(listingId) ?? 0;
    const previous = previousAttributionByListing?.get(listingId) ?? 0;
    return {
      listing_id: listingId,
      log_download_hits: scan.log_download_hits,
      log_demand_hits: scan.log_demand_hits,
      log_total_hits: scan.log_download_hits + scan.log_demand_hits,
      current_attribution_total: current,
      previous_attribution_total: previousAttributionByListing ? previous : null,
      attribution_delta_vs_previous: previousAttributionByListing ? (current - previous) : null,
      download_versions_seen: Object.keys(scan.versions).length,
      top_versions: Object.entries(scan.versions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([version, hits]) => `${version}:${hits}`),
    };
  });
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const cutoffMs = Date.now() - (cli.days * 24 * 60 * 60 * 1000);
  const assetToListing = buildMapAssetKeyToListing(cli.repoRoot);
  const currentLedger = readLedgerAtPath(resolve(cli.repoRoot, "history", "registry-download-attribution.json"));
  const currentByListing = aggregateLedgerByListing(currentLedger, assetToListing);

  const previousByListing = cli.compareRef
    ? aggregateLedgerByListing(readLedgerAtRef(cli.repoRoot, cli.compareRef), assetToListing)
    : null;

  let selectedMaps = [...cli.maps];
  if (selectedMaps.length === 0 && previousByListing) {
    const deltas = [...new Set([...currentByListing.keys(), ...previousByListing.keys()])]
      .map((listingId) => ({
        listingId,
        delta: (currentByListing.get(listingId) ?? 0) - (previousByListing.get(listingId) ?? 0),
      }))
      .filter((row) => row.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, cli.topLoss)
      .map((row) => row.listingId);
    selectedMaps = deltas;
  }

  if (selectedMaps.length === 0) {
    throw new Error("No maps selected. Provide --maps <id1,id2,...> or --compare-ref <git-ref>.");
  }

  const selectedSet = new Set(selectedMaps);
  const runs = await listWorkflowRuns(cli.repoFullName, cli.token, cutoffMs, cli.maxRuns);
  const scanStatsByListing = new Map<string, ListingScanStats>();

  let runsWithLogs = 0;
  for (const run of runs) {
    const logsUrl = `https://api.github.com/repos/${cli.repoFullName}/actions/runs/${run.id}/logs`;
    let zip: JSZip;
    try {
      const bytes = await fetchArrayBuffer(logsUrl, cli.token);
      zip = await JSZip.loadAsync(Buffer.from(bytes));
      runsWithLogs += 1;
    } catch {
      continue;
    }

    for (const file of Object.values(zip.files)) {
      if (file.dir) continue;
      let content: string;
      try {
        content = await file.async("string");
      } catch {
        continue;
      }
      const hits = parseAttributionBackfillLogHits(content, run.created_at);
      for (const hit of hits) {
        if (!selectedSet.has(hit.listingId)) continue;
        const existing = scanStatsByListing.get(hit.listingId) ?? {
          log_download_hits: 0,
          log_demand_hits: 0,
          versions: {},
        };
        if (hit.kind === "downloads") {
          existing.log_download_hits += 1;
          existing.versions[hit.version] = (existing.versions[hit.version] ?? 0) + 1;
        } else {
          existing.log_demand_hits += 1;
        }
        scanStatsByListing.set(hit.listingId, existing);
      }
    }
  }

  const rows = toListingRows(selectedMaps, scanStatsByListing, currentByListing, previousByListing);
  console.log(`[spotcheck-attribution] scanned runs=${runs.length}, runs_with_logs=${runsWithLogs}, days=${cli.days}`);
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }

  if (cli.outputPath) {
    const output = {
      generated_at: new Date().toISOString(),
      repo: cli.repoFullName,
      days: cli.days,
      max_runs: cli.maxRuns,
      compare_ref: cli.compareRef ?? null,
      selected_maps: selectedMaps,
      runs_scanned: runs.length,
      runs_with_logs: runsWithLogs,
      rows,
    };
    writeFileSync(resolve(cli.repoRoot, cli.outputPath), `${JSON.stringify(output, null, 2)}\n`, "utf-8");
    console.log(`[spotcheck-attribution] wrote ${cli.outputPath}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

