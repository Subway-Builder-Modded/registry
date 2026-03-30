import { pathToFileURL } from "node:url";
import { runDownloadAttributionBackfillCli } from "./lib/download-attribution-backfill-core.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDownloadAttributionBackfillCli(
    process.argv.slice(2),
    process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname),
  ).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
