import { pathToFileURL } from "node:url";
import { runGenerateAnalyticsCli } from "./lib/analytics-core.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runGenerateAnalyticsCli();
}
