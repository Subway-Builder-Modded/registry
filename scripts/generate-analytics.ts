import { pathToFileURL } from "node:url";
import { runGenerateAnalyticsCli } from "./lib/analytics-core.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runGenerateAnalyticsCli(process.argv.slice(2), process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname));
}
