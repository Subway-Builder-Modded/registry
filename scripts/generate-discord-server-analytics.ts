import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDiscordUsersByDayCsvRows,
  loadDiscordServerMetricsHistory,
} from "./lib/discord-server-metrics.js";
import { writeCsv } from "./lib/csv.js";
import { resolveRepoRoot } from "./lib/script-runtime.js";

interface CliArgs {
  repoRoot: string;
  lookbackDays: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  let lookbackDays: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--lookback-days") {
      const rawValue = argv[index + 1];
      const parsedValue = Number(rawValue);
      if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        throw new Error("--lookback-days requires a positive integer value.");
      }
      lookbackDays = parsedValue;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    repoRoot: process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname),
    lookbackDays,
  };
}

function applyLookback<T extends { date: string }>(rows: T[], lookbackDays: number | null): T[] {
  if (lookbackDays === null || rows.length === 0) {
    return rows;
  }

  const latestDate = rows[rows.length - 1]?.date;
  const latestMs = latestDate ? Date.parse(`${latestDate}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(latestMs)) {
    return rows;
  }

  const cutoffMs = latestMs - ((lookbackDays - 1) * 24 * 60 * 60 * 1000);
  return rows.filter((row) => {
    const rowMs = Date.parse(`${row.date}T00:00:00.000Z`);
    return Number.isFinite(rowMs) && rowMs >= cutoffMs;
  });
}

function run(): void {
  const cli = parseArgs(process.argv.slice(2));
  const repoRoot = cli.repoRoot;
  const analyticsDir = join(repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const history = loadDiscordServerMetricsHistory(repoRoot);
  const usersRows = applyLookback(
    buildDiscordUsersByDayCsvRows(history),
    cli.lookbackDays,
  );

  writeCsv(
    join(analyticsDir, "discord_users_by_day.csv"),
    ["date", "total_users", "users_joined", "users_left"],
    usersRows,
  );

  console.log(
    `Generated discord user analytics in ${analyticsDir} (userDays=${usersRows.length}${cli.lookbackDays === null ? "" : `, lookbackDays=${cli.lookbackDays}`})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
