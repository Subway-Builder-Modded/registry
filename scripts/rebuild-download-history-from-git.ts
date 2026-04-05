import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeDownloadHistorySnapshot,
  type DownloadHistorySnapshot,
} from "./lib/download-history.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

const ATTRIBUTION_ROLLOUT_COMMIT = "60e49f4cb10e6900e12bfaf3b48a06a27eb48f85";
const DOWNLOAD_SOURCE_PATHS = [
  "maps/downloads.json",
  "mods/downloads.json",
  "maps/index.json",
  "mods/index.json",
] as const;

interface HistoricalSnapshotSource {
  fileName: string;
  botCommit: string;
  botTimestamp: string;
  sourceCommit: string;
  generatedAt: string;
  mapsSourceDownloadsMode?: "already_adjusted" | "legacy_unadjusted";
  modsSourceDownloadsMode?: "already_adjusted" | "legacy_unadjusted";
}

interface CliOptions {
  fromDate?: string;
}

interface LegacySnapshot {
  schema_version: 1;
  snapshot_date: string;
  generated_at: string;
  total_downloads: number;
  maps: {
    downloads: Record<string, Record<string, number>>;
    total_downloads: number;
    net_downloads: number;
    index: Record<string, unknown>;
    entries: number;
  };
  mods: {
    downloads: Record<string, Record<string, number>>;
    total_downloads: number;
    net_downloads: number;
    index: Record<string, unknown>;
    entries: number;
  };
}

function runGit(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function tryGitShow(repoRoot: string, spec: string): string | null {
  try {
    return execFileSync("git", ["show", spec], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
}

function readJsonFromCommit<T>(repoRoot: string, commit: string, path: string): T {
  const raw = tryGitShow(repoRoot, `${commit}:${path}`);
  if (raw === null) {
    throw new Error(`Missing '${path}' at commit ${commit}`);
  }
  return JSON.parse(raw) as T;
}

function tryReadJsonFromCommit<T>(repoRoot: string, commit: string, path: string): T | null {
  const raw = tryGitShow(repoRoot, `${commit}:${path}`);
  return raw === null ? null : JSON.parse(raw) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function sumDownloads(downloads: Record<string, Record<string, number>>): number {
  let total = 0;
  for (const byVersion of Object.values(downloads)) {
    for (const count of Object.values(byVersion)) {
      total += count;
    }
  }
  return total;
}

function buildSyntheticIntegrityFromDownloads(
  downloads: Record<string, Record<string, number>>,
): Record<string, unknown> {
  const listings: Record<string, unknown> = {};
  for (const [listingId, byVersion] of Object.entries(downloads)) {
    const versions = Object.keys(byVersion).sort();
    listings[listingId] = {
      has_complete_version: versions.length > 0,
      latest_semver_version: versions.length > 0 ? versions[versions.length - 1] : null,
      latest_semver_complete: versions.length > 0 ? true : null,
      complete_versions: versions,
      incomplete_versions: [],
      versions: Object.fromEntries(versions.map((version) => [version, { is_complete: true }])),
    };
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    listings,
  };
}

function listSnapshotFiles(repoRoot: string): string[] {
  const historyDir = resolve(repoRoot, "history");
  return existsSync(historyDir)
    ? readdirSync(historyDir).filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name)).sort()
    : [];
}

function normalizeDateArg(raw: string): string | null {
  const trimmed = raw.trim();
  const normalized = trimmed.replaceAll("-", "_");
  return /^\d{4}_\d{2}_\d{2}$/.test(normalized) ? normalized : null;
}

function parseCliOptions(argv: string[]): CliOptions {
  let fromDate: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from-date" || arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Missing value after ${arg}`);
      }
      const parsed = normalizeDateArg(next);
      if (!parsed) {
        throw new Error(`Invalid date '${next}'. Use YYYY_MM_DD or YYYY-MM-DD`);
      }
      fromDate = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--from-date=") || arg.startsWith("--date=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      const parsed = normalizeDateArg(value);
      if (!parsed) {
        throw new Error(`Invalid date '${value}'. Use YYYY_MM_DD or YYYY-MM-DD`);
      }
      fromDate = parsed;
      continue;
    }
    if (arg === "--") continue;
    throw new Error(`Unknown argument '${arg}'. Supported: --from-date <YYYY_MM_DD>`);
  }
  return { fromDate };
}

function resolveLatestBotCommitForSnapshot(repoRoot: string, fileName: string): { commit: string; timestamp: string } {
  const raw = runGit(repoRoot, ["log", "--format=%H\t%an\t%aI", "--", `history/${fileName}`]);
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines) {
    const [commit, author, timestamp] = line.split("\t");
    if (author === "github-actions[bot]" && commit && timestamp) {
      return { commit, timestamp };
    }
  }
  throw new Error(`No github-actions[bot] commit found for history/${fileName}`);
}

function resolveSourceCommitAtTime(repoRoot: string, timestamp: string): string {
  const commit = runGit(repoRoot, ["rev-list", "-1", "--first-parent", `--before=${timestamp}`, "HEAD"]);
  if (commit === "") {
    throw new Error(`Failed to resolve source commit before ${timestamp}`);
  }
  return commit;
}

function resolveHistoricalSourceCommit(repoRoot: string, generatedAt: string): string {
  const commit = runGit(repoRoot, [
    "log",
    "-1",
    "--first-parent",
    "--format=%H",
    `--before=${generatedAt}`,
    "--",
    ...DOWNLOAD_SOURCE_PATHS,
  ]);
  return commit !== "" ? commit : resolveSourceCommitAtTime(repoRoot, generatedAt);
}

function isCommitAtOrAfterRollout(repoRoot: string, commit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ATTRIBUTION_ROLLOUT_COMMIT, commit], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function buildHistoricalSources(repoRoot: string): HistoricalSnapshotSource[] {
  return listSnapshotFiles(repoRoot).map((fileName) => {
    const { commit: botCommit, timestamp: botTimestamp } = resolveLatestBotCommitForSnapshot(repoRoot, fileName);
    const originalSnapshot = readJsonFromCommit<{
      schema_version?: number;
      generated_at?: string;
      maps?: { source_downloads_mode?: string };
      mods?: { source_downloads_mode?: string };
    }>(
      repoRoot,
      botCommit,
      `history/${fileName}`,
    );
    const generatedAt = typeof originalSnapshot.generated_at === "string" ? originalSnapshot.generated_at : botTimestamp;
    const sourceCommit = resolveHistoricalSourceCommit(repoRoot, generatedAt);
    const inferredDefaultMode = isCommitAtOrAfterRollout(repoRoot, sourceCommit)
      ? "already_adjusted"
      : "legacy_unadjusted";
    const mapsSourceDownloadsMode = (
      originalSnapshot.maps?.source_downloads_mode === "legacy_unadjusted"
      || originalSnapshot.maps?.source_downloads_mode === "already_adjusted"
    )
      ? originalSnapshot.maps.source_downloads_mode
      : inferredDefaultMode;
    const modsSourceDownloadsMode = (
      originalSnapshot.mods?.source_downloads_mode === "legacy_unadjusted"
      || originalSnapshot.mods?.source_downloads_mode === "already_adjusted"
    )
      ? originalSnapshot.mods.source_downloads_mode
      : inferredDefaultMode;
    return {
      fileName,
      botCommit,
      botTimestamp,
      sourceCommit,
      generatedAt,
      mapsSourceDownloadsMode,
      modsSourceDownloadsMode,
    };
  });
}

function writeHistoricalRepoState(tempRepoRoot: string, liveRepoRoot: string, sourceCommit: string): void {
  for (const section of ["maps", "mods"] as const) {
    const indexPath = `${section}/index.json`;
    const downloadsPath = `${section}/downloads.json`;
    const integrityPath = `${section}/integrity.json`;
    const index = readJsonFromCommit<Record<string, unknown>>(liveRepoRoot, sourceCommit, indexPath);
    const downloads = readJsonFromCommit<Record<string, Record<string, number>>>(liveRepoRoot, sourceCommit, downloadsPath);
    const integrity = tryReadJsonFromCommit<Record<string, unknown>>(liveRepoRoot, sourceCommit, integrityPath)
      ?? buildSyntheticIntegrityFromDownloads(downloads);

    writeJson(resolve(tempRepoRoot, indexPath), index);
    writeJson(resolve(tempRepoRoot, downloadsPath), downloads);
    writeJson(resolve(tempRepoRoot, integrityPath), integrity);

    const ids = Array.isArray(index[section]) ? (index[section] as string[]).filter((value) => typeof value === "string") : [];
    for (const id of ids) {
      const manifestPath = `${section}/${id}/manifest.json`;
      const manifest = readJsonFromCommit<Record<string, unknown>>(liveRepoRoot, sourceCommit, manifestPath);
      writeJson(resolve(tempRepoRoot, manifestPath), manifest);
    }
  }
}

function buildLegacySnapshot(
  tempRepoRoot: string,
  snapshotDate: string,
  generatedAt: string,
): LegacySnapshot {
  const mapsIndex = JSON.parse(readFileSync(resolve(tempRepoRoot, "maps", "index.json"), "utf-8")) as Record<string, unknown>;
  const modsIndex = JSON.parse(readFileSync(resolve(tempRepoRoot, "mods", "index.json"), "utf-8")) as Record<string, unknown>;
  const mapsDownloads = JSON.parse(readFileSync(resolve(tempRepoRoot, "maps", "downloads.json"), "utf-8")) as Record<string, Record<string, number>>;
  const modsDownloads = JSON.parse(readFileSync(resolve(tempRepoRoot, "mods", "downloads.json"), "utf-8")) as Record<string, Record<string, number>>;

  const mapsTotal = sumDownloads(mapsDownloads);
  const modsTotal = sumDownloads(modsDownloads);

  return {
    schema_version: 1,
    snapshot_date: snapshotDate,
    generated_at: generatedAt,
    total_downloads: mapsTotal + modsTotal,
    maps: {
      downloads: mapsDownloads,
      total_downloads: mapsTotal,
      net_downloads: mapsTotal,
      index: mapsIndex,
      entries: Array.isArray(mapsIndex.maps) ? mapsIndex.maps.length : 0,
    },
    mods: {
      downloads: modsDownloads,
      total_downloads: modsTotal,
      net_downloads: modsTotal,
      index: modsIndex,
      entries: Array.isArray(modsIndex.mods) ? modsIndex.mods.length : 0,
    },
  };
}

function run(): void {
  const cli = parseCliOptions(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const tempRepoRoot = mkdtempSync(resolve(tmpdir(), "railyard-history-rebuild-"));
  const warnings: string[] = [];

  try {
    mkdirSync(resolve(tempRepoRoot, "history"), { recursive: true });
    writeJson(
      resolve(tempRepoRoot, "history", "registry-download-attribution.json"),
      JSON.parse(readFileSync(resolve(repoRoot, "history", "registry-download-attribution.json"), "utf-8")),
    );

    const allSnapshotFiles = listSnapshotFiles(repoRoot);
    const startFileName = cli.fromDate ? `snapshot_${cli.fromDate}.json` : null;
    const sources = buildHistoricalSources(repoRoot)
      .filter((source) => (startFileName ? source.fileName >= startFileName : true));
    if (startFileName && sources.length === 0) {
      throw new Error(`No snapshot files found at or after ${startFileName}`);
    }

    let previousSnapshot: DownloadHistorySnapshot | null = null;
    if (sources.length > 0) {
      const firstFile = sources[0]!.fileName;
      const previousFile = allSnapshotFiles.filter((name) => name < firstFile).sort().at(-1);
      if (previousFile) {
        try {
          previousSnapshot = JSON.parse(
            readFileSync(resolve(repoRoot, "history", previousFile), "utf-8"),
          ) as DownloadHistorySnapshot;
        } catch {
          previousSnapshot = null;
        }
      }
    }

    const updatedFiles: string[] = [];

    for (const source of sources) {
      writeHistoricalRepoState(tempRepoRoot, repoRoot, source.sourceCommit);

      const snapshotDate = source.fileName.replace(/^snapshot_/, "").replace(/\.json$/, "");
      const provisional = buildLegacySnapshot(tempRepoRoot, snapshotDate, source.generatedAt) as unknown as DownloadHistorySnapshot;
      provisional.maps.source_downloads_mode = source.mapsSourceDownloadsMode ?? "already_adjusted";
      provisional.mods.source_downloads_mode = source.modsSourceDownloadsMode ?? "already_adjusted";

      const normalized = normalizeDownloadHistorySnapshot({
        repoRoot: tempRepoRoot,
        snapshot: provisional,
        previousSnapshot,
        warnings,
        fileName: source.fileName,
      });
      writeJson(resolve(tempRepoRoot, "history", source.fileName), normalized);
      writeJson(resolve(repoRoot, "history", source.fileName), normalized);
      updatedFiles.push(`history/${source.fileName}`);
      previousSnapshot = normalized;

      console.log(
        `[rebuild-download-history-from-git] rebuilt ${source.fileName} sourceCommit=${source.sourceCommit} botCommit=${source.botCommit} mapsTotal=${normalized.maps.total_downloads} modsTotal=${normalized.mods.total_downloads}`,
      );
    }

    console.log(`[rebuild-download-history-from-git] done rebuilt=${updatedFiles.length}`);
    if (warnings.length > 0) {
      for (const warning of warnings.slice(0, 50)) {
        console.warn(`[rebuild-download-history-from-git] ${warning}`);
      }
      if (warnings.length > 50) {
        console.warn(`[rebuild-download-history-from-git] ...and ${warnings.length - 50} more warnings`);
      }
    }
  } finally {
    rmSync(tempRepoRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
