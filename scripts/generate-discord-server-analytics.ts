import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDiscordServerByDayCsvRows,
  buildDiscordUserMessageByDayCsvRows,
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
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
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
  const analyticsDir = join(cli.repoRoot, "analytics");
  mkdirSync(analyticsDir, { recursive: true });

  const history = loadDiscordServerMetricsHistory(cli.repoRoot);
  const rows = applyLookback(
    buildDiscordServerByDayCsvRows(history),
    cli.lookbackDays,
  );
  const allowedDates = new Set(rows.map((row) => row.date));
  const userRows = buildDiscordUserMessageByDayCsvRows(history, 100, allowedDates);

  writeCsv(
    join(analyticsDir, "discord_server_by_day.csv"),
    [
      "date",
      "total_users",
      "users_joined",
      "users_left",
      "total_messages",
      "messages_created",
      "messages_deleted",
      "public_total_messages",
      "public_messages_created",
      "public_messages_deleted",
      "private_total_messages",
      "private_messages_created",
      "private_messages_deleted",
    ],
    rows,
  );
  writeCsv(
    join(analyticsDir, "discord_user_message_by_day.csv"),
    [
      "date",
      "user_id",
      "user_name",
      "total_messages",
      "public_messages",
      "private_messages",
    ],
    userRows,
  );

  console.log(
    `Generated discord server analytics in ${analyticsDir} (days=${rows.length}, userRows=${userRows.length}${cli.lookbackDays === null ? "" : `, lookbackDays=${cli.lookbackDays}`})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
