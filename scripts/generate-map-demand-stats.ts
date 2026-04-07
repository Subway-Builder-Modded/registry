import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateMapDemandStats } from "./lib/map-demand-stats.js";
import {
  createDownloadAttributionDelta,
  sumDownloadAttributionDeltaFetches,
  writeDownloadAttributionDeltaFile,
} from "./lib/download-attribution.js";
import { appendGitHubOutput, getNonEmptyEnv, isTruthyEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";
import { filterListingMessages, isTestListing } from "./lib/test-listings.js";

function parseCliArgs(argv: string[]): { force: boolean; mapId?: string; strictFingerprintCache: boolean } {
  let force = false;
  let mapId: string | undefined;
  let strictFingerprintCache = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--strict-fingerprint-cache") {
      strictFingerprintCache = true;
      continue;
    }
    if (arg === "--id" || arg === "-id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing map id value after '${arg}'`);
      }
      mapId = value.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--id=") || arg.startsWith("-id=")) {
      const value = arg.slice(arg.indexOf("=") + 1).trim();
      if (value === "") {
        throw new Error(`Missing map id value in '${arg}'`);
      }
      mapId = value;
      continue;
    }
    throw new Error(
      `Unknown argument '${arg}'. Supported flags: --force, --strict-fingerprint-cache, --id <map-id>, -id <map-id>.`,
    );
  }

  return { force, mapId, strictFingerprintCache };
}

function toWarningsOutputJson(prefix: string, warnings: string[]): string {
  const MAX_WARNINGS = 30;
  const normalized = warnings
    .map((warning) => warning.trim())
    .filter((warning) => warning !== "")
    .map((warning) => `${prefix}${warning}`);
  const displayed = normalized.slice(0, MAX_WARNINGS);
  if (normalized.length > displayed.length) {
    displayed.push(`...and ${normalized.length - displayed.length} more warnings`);
  }
  return JSON.stringify(displayed);
}

async function run(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const runId = getNonEmptyEnv("GITHUB_RUN_ID") ?? "local";
  const jobId = getNonEmptyEnv("GITHUB_JOB") ?? "manual";
  const workflowName = getNonEmptyEnv("GITHUB_WORKFLOW") ?? "local";
  const attributionDeltaPath = (
    getNonEmptyEnv("DOWNLOAD_ATTRIBUTION_DELTA_PATH")
    ?? resolve(repoRoot, "maps", "demand-attribution-delta.json")
  );
  const attributionDelta = createDownloadAttributionDelta(
    `workflow:${workflowName}:map-demand-stats`,
    `${runId}:${jobId}:map-demand-stats`,
  );
  const token = getNonEmptyEnv("GH_DOWNLOADS_TOKEN") ?? getNonEmptyEnv("GITHUB_TOKEN");
  const strictFingerprintCache = (
    cli.strictFingerprintCache
    || isTruthyEnv(process.env.STRICT_FINGERPRINT_CACHE)
    || isTruthyEnv(process.env.REGISTRY_STRICT_FINGERPRINT_CACHE)
  );
  const tokenSource = getNonEmptyEnv("GH_DOWNLOADS_TOKEN")
    ? "GH_DOWNLOADS_TOKEN"
    : (getNonEmptyEnv("GITHUB_TOKEN") ? "GITHUB_TOKEN" : "none");

  console.log(`[map-demand-stats] Auth token source: ${tokenSource}`);
  if (!token) {
    console.warn(
      "[map-demand-stats] No non-empty GitHub token configured (GH_DOWNLOADS_TOKEN/GITHUB_TOKEN). GraphQL requests are likely to fail with 401.",
    );
  }

  console.log(
    `[map-demand-stats] Run mode: ${cli.force ? "force" : "cached"}${cli.mapId ? `, mapId=${cli.mapId}` : ", mapId=all"}, strictFingerprintCache=${strictFingerprintCache ? "enabled" : "disabled"}`,
  );

  const result = await generateMapDemandStats({
    repoRoot,
    token,
    force: cli.force,
    mapId: cli.mapId,
    strictFingerprintCache,
    attributionDelta,
  });
  writeDownloadAttributionDeltaFile(attributionDeltaPath, attributionDelta);

  for (const warning of result.warnings) {
    console.warn(`[map-demand-stats] ${warning}`);
  }

  console.log(
    `[map-demand-stats] GraphQL usage: queries=${result.rateLimit.queries}, totalCost=${result.rateLimit.totalCost}, firstRemaining=${result.rateLimit.firstRemaining ?? "n/a"}, lastRemaining=${result.rateLimit.lastRemaining ?? "n/a"}, estimatedConsumed=${result.rateLimit.estimatedConsumed ?? "n/a"}, resetAt=${result.rateLimit.resetAt ?? "n/a"}`,
  );
  console.log(
    `[map-demand-stats] Summary: processedMaps=${result.processedMaps}, updatedMaps=${result.updatedMaps}, gridFilesWritten=${result.gridFilesWritten}, skippedMaps=${result.skippedMaps}, skippedUnchanged=${result.skippedUnchanged}, extractionFailures=${result.extractionFailures}, residentsDeltaTotal=${result.residentsDeltaTotal}`,
  );
  console.log(
    `[map-demand-stats] Attribution stats: registryFetchesAdded=${sumDownloadAttributionDeltaFetches(attributionDelta)}`,
  );

  const warningsForDiscord = filterListingMessages(
    result.warnings,
    (listingId) => isTestListing(repoRoot, "maps", listingId),
  );

  appendGitHubOutput([
    `processed_maps=${result.processedMaps}`,
    `updated_maps=${result.updatedMaps}`,
    `grid_files_written=${result.gridFilesWritten}`,
    `skipped_maps=${result.skippedMaps}`,
    `skipped_unchanged=${result.skippedUnchanged}`,
    `extraction_failures=${result.extractionFailures}`,
    `residents_delta_total=${result.residentsDeltaTotal}`,
    `graphql_queries=${result.rateLimit.queries}`,
    `graphql_total_cost=${result.rateLimit.totalCost}`,
    `attribution_fetches_added=${result.attributionFetchesAdded}`,
    `warning_count=${warningsForDiscord.length}`,
    `warnings_json=${toWarningsOutputJson("map-demand-stats: ", warningsForDiscord)}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
