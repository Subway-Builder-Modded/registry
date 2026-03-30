import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildRailyardAppAnalytics,
  buildRailyardAppAnalyticsCsvRows,
  listRailyardAppAnalyticsAssetNames,
  loadRailyardAppDownloadHistory,
  type RailyardAppCsvRow,
} from "./lib/railyard-app-downloads.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function writeCsv(path: string, headers: string[], rows: RailyardAppCsvRow[]): void {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header] ?? "")).join(","));
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf-8");
}

function run(): void {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const analyticsDir = join(repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const history = loadRailyardAppDownloadHistory(repoRoot);
  const analytics = buildRailyardAppAnalytics(history);
  const rows = buildRailyardAppAnalyticsCsvRows(analytics);
  const assetNames = listRailyardAppAnalyticsAssetNames(analytics);
  const headers = [
    "version",
    "total_downloads",
    "last_1d_downloads",
    "last_3d_downloads",
    "last_7d_downloads",
    ...assetNames.flatMap((assetName) => ([
      `${assetName}_total_downloads`,
      `${assetName}_last_1d_downloads`,
      `${assetName}_last_3d_downloads`,
      `${assetName}_last_7d_downloads`,
    ])),
  ];

  writeFileSync(
    join(analyticsDir, "railyard_app_downloads.json"),
    `${JSON.stringify(analytics, null, 2)}\n`,
    "utf-8",
  );
  writeCsv(
    join(analyticsDir, "railyard_app_downloads.csv"),
    headers,
    rows,
  );

  console.log(
    `Generated railyard app download analytics in ${analyticsDir} (versions=${rows.length}, assets=${assetNames.length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
