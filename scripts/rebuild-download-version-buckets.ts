import { pathToFileURL } from "node:url";
import { rebuildDownloadVersionBucketsFromHistory } from "./lib/download-version-buckets-history.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const result = rebuildDownloadVersionBucketsFromHistory(repoRoot);
  console.log(
    `[download-version-buckets] rebuilt from history snapshots=${result.snapshotFilesScanned}, maps_versions=${result.mapsListingVersionsSeeded}, mods_versions=${result.modsListingVersionsSeeded}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}

