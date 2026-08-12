import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  computeListingDeltas,
  HOURLY_DOWNLOADS_CSV_RELATIVE_PATH,
  mergeHourlyRows,
  parseHourlyDownloadsCsv,
  pruneHourlyRows,
  serializeHourlyDownloadsCsv,
  truncateToHourBucketUtc,
  type DownloadsFile,
  type HourlyDownloadRow,
  type HourlyListingType,
} from "../lib/hourly-downloads.js";
import { runGitCommand } from "../lib/git-history.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// Appends this run's per-listing download deltas to the hourly series
// (analytics/hourly/downloads.csv). Runs in the hourly workflow's commit job
// AFTER the regenerated downloads.json artifacts are copied into the working
// tree: the previous state is read from git HEAD (main's last committed
// counters), the new state from disk. A missing HEAD baseline skips the
// listing type rather than booking the whole cumulative counter as one hour.

interface TypeSpec {
  listingType: HourlyListingType;
  relativePath: string;
}

const TYPE_SPECS: TypeSpec[] = [
  { listingType: "map", relativePath: "maps/downloads.json" },
  { listingType: "mod", relativePath: "mods/downloads.json" },
];

function readHeadDownloads(repoRoot: string, relativePath: string): DownloadsFile | null {
  const content = runGitCommand(repoRoot, ["show", `HEAD:${relativePath}`]);
  if (!content) return null;
  try {
    return JSON.parse(content) as DownloadsFile;
  } catch {
    return null;
  }
}

function readWorkingDownloads(repoRoot: string, relativePath: string): DownloadsFile | null {
  const path = resolve(repoRoot, ...relativePath.split("/"));
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DownloadsFile;
  } catch {
    return null;
  }
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const nowMs = Date.now();
  const bucket = truncateToHourBucketUtc(new Date(nowMs).toISOString());

  const additions: HourlyDownloadRow[] = [];
  for (const spec of TYPE_SPECS) {
    const previous = readHeadDownloads(repoRoot, spec.relativePath);
    const next = readWorkingDownloads(repoRoot, spec.relativePath);
    if (!previous || !next) {
      console.warn(`[hourly-downloads] missing ${!previous ? "HEAD" : "working"} state for ${spec.relativePath}; skipping ${spec.listingType}s`);
      continue;
    }
    for (const delta of computeListingDeltas(spec.listingType, previous, next)) {
      additions.push({ bucket_utc: bucket, ...delta });
    }
  }

  const csvPath = resolve(repoRoot, ...HOURLY_DOWNLOADS_CSV_RELATIVE_PATH.split("/"));
  const existing = existsSync(csvPath)
    ? parseHourlyDownloadsCsv(readFileSync(csvPath, "utf-8"))
    : [];
  const merged = pruneHourlyRows(mergeHourlyRows(existing, additions), nowMs);
  const serialized = serializeHourlyDownloadsCsv(merged);

  const previousSerialized = existsSync(csvPath) ? readFileSync(csvPath, "utf-8") : "";
  if (serialized === previousSerialized) {
    console.log(`[hourly-downloads] bucket=${bucket} no changes (deltas=0, nothing pruned)`);
    appendGitHubOutput(["hourly_downloads_changed=false"]);
    return;
  }

  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, serialized, "utf-8");
  const totalNew = additions.reduce((sum, row) => sum + row.downloads, 0);
  console.log(
    `[hourly-downloads] bucket=${bucket} listings=${additions.length} downloads=${totalNew} rows=${merged.length}`,
  );
  appendGitHubOutput([
    "hourly_downloads_changed=true",
    `hourly_downloads_new=${totalNew}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
