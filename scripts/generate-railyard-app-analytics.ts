import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildRailyardAppAnalytics,
  buildRailyardAppByDayCsvRows,
  loadRailyardAppDownloadHistory,
} from "./lib/railyard-app-downloads.js";
import { writeCsv } from "./lib/csv.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

function run(): void {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const analyticsDir = join(repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const history = loadRailyardAppDownloadHistory(repoRoot);
  const analytics = buildRailyardAppAnalytics(history);
  const byDay = buildRailyardAppByDayCsvRows(history);

  writeFileSync(
    join(analyticsDir, "railyard_app_downloads.json"),
    `${JSON.stringify(analytics, null, 2)}\n`,
    "utf-8",
  );
  writeCsv(
    join(analyticsDir, "railyard_app_by_day.csv"),
    byDay.headers,
    byDay.rows,
  );

  console.log(
    `Generated railyard app download analytics in ${analyticsDir} (versions=${Object.keys(analytics.versions).length}, byDayVersions=${byDay.rows.length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
