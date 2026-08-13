import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyHourlySuppressions,
  computeListingDeltas,
  HOURLY_DOWNLOADS_CSV_RELATIVE_PATH,
  HOURLY_DOWNLOADS_RETENTION_DAYS,
  HOURLY_SUPPRESSIONS_RELATIVE_PATH,
  mergeHourlyRows,
  parseHourlySuppressions,
  serializeHourlyDownloadsCsv,
  truncateToHourBucketUtc,
  type DownloadsFile,
  type HourlyDownloadRow,
  type HourlyListingType,
} from "../lib/hourly-downloads.js";
import { runGitCommand } from "../lib/git-history.js";
import { getFlagValue } from "../lib/cli.js";
import { resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// Rebuilds the hourly download series from git history: every hourly bot run
// commits downloads.json, so pairwise deltas between consecutive commits ARE
// the hourly series. Deterministic and idempotent — the file is regenerated
// wholesale for the window, so this is both the initial backfill and the
// disaster-recovery path (re-run after any history rewrite).
//
//   pnpm --dir scripts run backfill-hourly-downloads [-- --days 14]
//
// Requires full local history for the window (a shallow clone will silently
// truncate the series; the commit-count sanity check below guards this).

interface TypeSpec {
  listingType: HourlyListingType;
  relativePath: string;
}

const TYPE_SPECS: TypeSpec[] = [
  { listingType: "map", relativePath: "maps/downloads.json" },
  { listingType: "mod", relativePath: "mods/downloads.json" },
];

// Approximate hourly cadence; used only for the shallow-clone sanity check.
const MIN_EXPECTED_COMMITS_PER_DAY = 12;

function parseDays(argv: string[]): number {
  const value = getFlagValue(argv, "days");
  if (value === undefined) return HOURLY_DOWNLOADS_RETENTION_DAYS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 60) {
    throw new Error(`Invalid --days '${value}'; expected 1-60.`);
  }
  return parsed;
}

interface CommitRef {
  sha: string;
  committedAt: string;
}

// Commits ascending in time, extended one commit before the window so the
// first in-window commit has a delta baseline.
function listCommitsForPath(repoRoot: string, relativePath: string, sinceMs: number): CommitRef[] {
  const sinceIso = new Date(sinceMs).toISOString();
  const output = runGitCommand(repoRoot, [
    "log", "--since", sinceIso, "--format=%H %cI", "--reverse", "--", relativePath,
  ]);
  const commits: CommitRef[] = (output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [sha, committedAt] = line.split(" ") as [string, string];
      return { sha, committedAt };
    });

  const baseline = runGitCommand(repoRoot, [
    "log", "-1", "--before", sinceIso, "--format=%H %cI", "--", relativePath,
  ]);
  if (baseline) {
    const [sha, committedAt] = baseline.trim().split(" ") as [string, string];
    commits.unshift({ sha, committedAt });
  }
  return commits;
}

function readDownloadsAtCommit(
  repoRoot: string,
  sha: string,
  relativePath: string,
): DownloadsFile | null {
  const content = runGitCommand(repoRoot, ["show", `${sha}:${relativePath}`]);
  if (!content) return null;
  try {
    return JSON.parse(content) as DownloadsFile;
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const days = parseDays(process.argv.slice(2));
  const nowMs = Date.now();
  const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
  const windowStart = truncateToHourBucketUtc(new Date(sinceMs).toISOString());

  let rows: HourlyDownloadRow[] = [];
  for (const spec of TYPE_SPECS) {
    const commits = listCommitsForPath(repoRoot, spec.relativePath, sinceMs);
    if (commits.length < days * MIN_EXPECTED_COMMITS_PER_DAY) {
      throw new Error(
        `Only ${commits.length} commits found for ${spec.relativePath} over ${days}d `
        + `(expected >= ${days * MIN_EXPECTED_COMMITS_PER_DAY}); shallow clone or wrong branch?`,
      );
    }
    let previous = readDownloadsAtCommit(repoRoot, commits[0]!.sha, spec.relativePath);
    let pairs = 0;
    for (const commit of commits.slice(1)) {
      const next = readDownloadsAtCommit(repoRoot, commit.sha, spec.relativePath);
      if (!next) continue;
      const bucket = truncateToHourBucketUtc(commit.committedAt);
      if (previous && bucket >= windowStart) {
        const additions = computeListingDeltas(spec.listingType, previous, next).map(
          (delta) => ({ bucket_utc: bucket, ...delta }),
        );
        rows = mergeHourlyRows(rows, additions);
        pairs += 1;
      }
      previous = next;
    }
    console.log(`[backfill-hourly-downloads] ${spec.listingType}s: ${commits.length} commits, ${pairs} in-window deltas`);
  }

  const suppressionsPath = resolve(repoRoot, ...HOURLY_SUPPRESSIONS_RELATIVE_PATH.split("/"));
  if (existsSync(suppressionsPath)) {
    const suppressions = parseHourlySuppressions(JSON.parse(readFileSync(suppressionsPath, "utf-8")));
    const applied = applyHourlySuppressions(rows, suppressions);
    rows = applied.rows;
    console.log(`[backfill-hourly-downloads] applied ${applied.suppressed} committed suppression(s)`);
  }

  const csvPath = resolve(repoRoot, ...HOURLY_DOWNLOADS_CSV_RELATIVE_PATH.split("/"));
  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, serializeHourlyDownloadsCsv(rows), "utf-8");

  const total = rows.reduce((sum, row) => sum + row.downloads, 0);
  const buckets = new Set(rows.map((row) => row.bucket_utc)).size;
  console.log(
    `[backfill-hourly-downloads] wrote ${rows.length} rows across ${buckets} hour buckets (${total} downloads, window ${days}d)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
