import { pathToFileURL } from "node:url";
import {
  loadWebsiteAnalyticsHistory,
  writeWebsiteAnalyticsHistory,
  upsertHourlySnapshot,
  updateValidPaths,
  toHourBucketIso,
  mergeSortedUniqueStrings,
} from "../lib/website-analytics.js";
import {
  captureWindowSnapshot,
  requireCloudflareCredentials,
  type CloudflareCredentials,
} from "../lib/website-analytics-capture.js";
import { loadLocalDotEnv, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

interface CliArgs extends CloudflareCredentials {
  repoRoot: string;
}

function parseArgs(): CliArgs {
  const repoRoot = resolveRepoRoot(import.meta.dirname);
  loadLocalDotEnv(repoRoot);
  return { repoRoot, ...requireCloudflareCredentials() };
}

async function run(): Promise<void> {
  const args = parseArgs();
  const now = new Date();
  const capturedAtIso = now.toISOString();
  const hourBucketIso = toHourBucketIso(now);

  // Load existing history
  let history = loadWebsiteAnalyticsHistory(args.repoRoot, args.zoneTag, capturedAtIso);

  // Capture the current hour
  const windowStartIso = hourBucketIso;
  const windowEndIso = new Date(new Date(windowStartIso).getTime() + 60 * 60 * 1000).toISOString();

  const snapshot = await captureWindowSnapshot({
    zoneTag: args.zoneTag,
    apiToken: args.apiToken,
    pathAliases: history.path_aliases,
    windowStartIso,
    windowEndIso,
    capturedAtIso,
    verbose: true,
  });

  // Upsert the hourly snapshot
  history = upsertHourlySnapshot({
    history,
    snapshot,
    snapshotKey: hourBucketIso,
    updatedAt: capturedAtIso,
  });

  const discoveredPaths = Object.keys(snapshot.pages).sort();
  history = updateValidPaths(
    history,
    mergeSortedUniqueStrings(history.valid_paths, discoveredPaths),
    capturedAtIso,
  );

  // Write back to history file
  writeWebsiteAnalyticsHistory(args.repoRoot, history);

  console.log(
    `Captured website analytics for hour ${hourBucketIso} (visits=${snapshot.totals.visits}, pages=${Object.keys(snapshot.pages).length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
