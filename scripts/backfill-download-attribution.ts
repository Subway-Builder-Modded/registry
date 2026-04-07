import { pathToFileURL } from "node:url";
import { runDownloadAttributionBackfillCli } from "./lib/download-attribution-backfill-core.js";
import { backfillDownloadAttributionHistorySnapshots } from "./lib/download-attribution-history.js";
import { rebuildDownloadVersionBucketsFromHistory } from "./lib/download-version-buckets-history.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  async function run(): Promise<void> {
    const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
    await runDownloadAttributionBackfillCli(
      process.argv.slice(2),
      repoRoot,
    );
    const attributionHistoryResult = backfillDownloadAttributionHistorySnapshots({ repoRoot });
    console.log(
      `[download-attribution-history] rebuilt snapshots=${attributionHistoryResult.updatedFiles.length}`,
    );
    for (const warning of attributionHistoryResult.warnings) {
      console.warn(`[download-attribution-history] ${warning}`);
    }
    const result = rebuildDownloadVersionBucketsFromHistory(repoRoot);
    console.log(
      `[download-version-buckets] rebuilt after attribution backfill: snapshots=${result.snapshotFilesScanned}, maps_versions=${result.mapsListingVersionsSeeded}, mods_versions=${result.modsListingVersionsSeeded}`,
    );
  }

  runAndExitOnError(run);
}
