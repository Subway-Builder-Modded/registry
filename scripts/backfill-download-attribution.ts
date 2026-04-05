import { pathToFileURL } from "node:url";
import { runDownloadAttributionBackfillCli } from "./lib/download-attribution-backfill-core.js";
import { rebuildDownloadVersionBucketsFromHistory } from "./lib/download-version-buckets-history.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  runDownloadAttributionBackfillCli(
    process.argv.slice(2),
    repoRoot,
  ).then(() => {
    const result = rebuildDownloadVersionBucketsFromHistory(repoRoot);
    console.log(
      `[download-version-buckets] rebuilt after attribution backfill: snapshots=${result.snapshotFilesScanned}, maps_versions=${result.mapsListingVersionsSeeded}, mods_versions=${result.modsListingVersionsSeeded}`,
    );
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
