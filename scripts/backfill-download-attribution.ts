import { pathToFileURL } from "node:url";
import { runDownloadAttributionBackfillCli } from "./lib/download-attribution-backfill-core.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runDownloadAttributionBackfillCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
