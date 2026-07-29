import { pathToFileURL } from "node:url";
import {
  type BotGuildContext,
  fetchBotGuildContext,
  fetchChannelMessages,
  fetchGuildCounts,
  fetchGuildMemberJoinCounts,
  fetchReadableChannels,
  isPublicChannel,
  REQUEST_DELAY_MS,
} from "../lib/discord-api.js";
import {
  createEmptyDiscordServerMetricsHistory,
  DEFAULT_DISCORD_SERVER_GUILD_ID,
  type DiscordMessageCreationCounts,
  type DiscordUserMessageCounts,
  loadDiscordServerMetricsHistory,
  replaceDiscordServerMessageUserCounts,
  toHourBucketIso,
  updateDiscordServerMessageDays,
  updateDiscordServerUserDays,
  upsertDiscordServerMetricsSnapshot,
  writeDiscordServerMetricsHistory,
} from "../lib/discord-server-metrics.js";
import { getNonEmptyEnv, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

interface CliArgs {
  repoRoot: string;
  guildId: string;
  token: string;
  resetHistory: boolean;
  skipMessages: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let resetHistory = false;
  let skipMessages = false;

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--reset-history") {
      resetHistory = true;
      continue;
    }
    if (arg === "--skip-messages") {
      skipMessages = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    repoRoot: process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname),
    guildId: (getNonEmptyEnv("DISCORD_SERVER_GUILD_ID") ?? DEFAULT_DISCORD_SERVER_GUILD_ID).trim(),
    token: (getNonEmptyEnv("DISCORD_BOT_TOKEN") ?? "").trim(),
    resetHistory,
    skipMessages,
  };
}

function mergeMessageCreationCounts(
  base: Record<string, DiscordMessageCreationCounts>,
  addition: Record<string, DiscordMessageCreationCounts>,
): Record<string, DiscordMessageCreationCounts> {
  const merged: Record<string, DiscordMessageCreationCounts> = { ...base };

  for (const [dateKey, counts] of Object.entries(addition)) {
    const entry = merged[dateKey] ?? {
      total_messages: 0,
      public_total_messages: 0,
      private_total_messages: 0,
    };
    merged[dateKey] = {
      total_messages: entry.total_messages + counts.total_messages,
      public_total_messages: entry.public_total_messages + counts.public_total_messages,
      private_total_messages: entry.private_total_messages + counts.private_total_messages,
    };
  }

  return merged;
}

function mergeUserMessageCounts(
  base: Record<string, Record<string, DiscordUserMessageCounts>>,
  addition: Record<string, Record<string, DiscordUserMessageCounts>>,
): Record<string, Record<string, DiscordUserMessageCounts>> {
  const merged: Record<string, Record<string, DiscordUserMessageCounts>> = { ...base };

  for (const [dateKey, perUser] of Object.entries(addition)) {
    const existingPerUser = { ...(merged[dateKey] ?? {}) };
    for (const [userId, counts] of Object.entries(perUser)) {
      const existing = existingPerUser[userId] ?? {
        total_messages: 0,
        public_messages: 0,
        private_messages: 0,
      };
      existingPerUser[userId] = {
        total_messages: existing.total_messages + counts.total_messages,
        public_messages: existing.public_messages + counts.public_messages,
        private_messages: existing.private_messages + counts.private_messages,
      };
    }
    merged[dateKey] = existingPerUser;
  }

  return merged;
}

async function fetchGuildMessageCreationCounts(
  context: BotGuildContext,
  token: string,
): Promise<{
  perDayCounts: Record<string, DiscordMessageCreationCounts>;
  perUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>>;
  userLabels: Record<string, string>;
}> {
  let perDayCounts: Record<string, DiscordMessageCreationCounts> = {};
  let perUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>> = {};
  const userLabels: Record<string, string> = {};
  const channels = await fetchReadableChannels(context, token);

  for (const channel of channels) {
    const scope = isPublicChannel(context, channel) ? "public" : "private";
    console.log(
      `[discord-server-metrics] counting messages in ${channel.name} (${channel.id}) type=${channel.type} scope=${scope}`,
    );
    const counts = await fetchChannelMessages(context, channel, token);
    perDayCounts = mergeMessageCreationCounts(perDayCounts, counts.perDayCounts);
    perUserPerDayCounts = mergeUserMessageCounts(perUserPerDayCounts, counts.perUserPerDayCounts);
    Object.assign(userLabels, counts.userLabels);
  }

  const sortedPerUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>> = {};
  for (const [dateKey, perUser] of Object.entries(perUserPerDayCounts)) {
    sortedPerUserPerDayCounts[dateKey] = Object.fromEntries(
      Object.entries(perUser).sort((a, b) => {
        if (b[1].total_messages !== a[1].total_messages) {
          return b[1].total_messages - a[1].total_messages;
        }
        return a[0].localeCompare(b[0]);
      }),
    );
  }

  return {
    perDayCounts: Object.fromEntries(
      Object.entries(perDayCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    perUserPerDayCounts: Object.fromEntries(
      Object.entries(sortedPerUserPerDayCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    userLabels,
  };
}

function sumMessageCreationCounts(messageCreationCounts: Record<string, DiscordMessageCreationCounts>): DiscordMessageCreationCounts {
  return Object.values(messageCreationCounts).reduce<DiscordMessageCreationCounts>(
    (sum, entry) => ({
      total_messages: sum.total_messages + entry.total_messages,
      public_total_messages: sum.public_total_messages + entry.public_total_messages,
      private_total_messages: sum.private_total_messages + entry.private_total_messages,
    }),
    {
      total_messages: 0,
      public_total_messages: 0,
      private_total_messages: 0,
    },
  );
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.token === "") {
    console.log("[discord-server-metrics] Missing DISCORD_BOT_TOKEN; skipping capture.");
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const snapshotKey = toHourBucketIso(now);
  const captureDate = nowIso.slice(0, 10);

  const counts = await fetchGuildCounts(cli.guildId, cli.token);
  const context = await fetchBotGuildContext(cli.guildId, cli.token);
  const memberJoinCounts = await fetchGuildMemberJoinCounts(cli.guildId, cli.token);
  const exactTotalUsers = Object.values(memberJoinCounts).reduce((sum, count) => sum + count, 0);
  const messageCapture = cli.skipMessages
    ? {
      perDayCounts: {},
      perUserPerDayCounts: {},
      userLabels: {},
    }
    : await fetchGuildMessageCreationCounts(context, cli.token);
  const messageTotals = cli.skipMessages
    ? {
      total_messages: 0,
      public_total_messages: 0,
      private_total_messages: 0,
    }
    : sumMessageCreationCounts(messageCapture.perDayCounts);

  const existingHistory = cli.resetHistory
    ? createEmptyDiscordServerMetricsHistory(cli.guildId, nowIso)
    : loadDiscordServerMetricsHistory(cli.repoRoot, cli.guildId, nowIso);

  const historyWithSnapshot = upsertDiscordServerMetricsSnapshot({
    history: existingHistory.guild_id === cli.guildId
      ? existingHistory
      : createEmptyDiscordServerMetricsHistory(cli.guildId, nowIso),
    snapshotKey,
    snapshot: {
      captured_at: snapshotKey,
      total_users: exactTotalUsers,
      online_users: counts.onlineUsers,
      total_messages: cli.skipMessages ? null : messageTotals.total_messages,
      public_total_messages: cli.skipMessages ? null : messageTotals.public_total_messages,
      private_total_messages: cli.skipMessages ? null : messageTotals.private_total_messages,
    },
    updatedAt: nowIso,
  });
  const historyWithUsers = updateDiscordServerUserDays({
    history: historyWithSnapshot,
    memberJoinCounts,
    captureDate,
    updatedAt: nowIso,
  });
  const historyWithMessages = cli.skipMessages
    ? historyWithUsers
    : updateDiscordServerMessageDays({
      history: historyWithUsers,
      messageCreationCounts: messageCapture.perDayCounts,
      captureDate,
      updatedAt: nowIso,
    });
  const history = cli.skipMessages
    ? historyWithMessages
    : replaceDiscordServerMessageUserCounts({
      history: historyWithMessages,
      messageUserCounts: messageCapture.perUserPerDayCounts,
      messageUserLabels: messageCapture.userLabels,
      updatedAt: nowIso,
    });

  writeDiscordServerMetricsHistory(cli.repoRoot, history);

  const userDaysWithMessages = Object.keys(messageCapture.perUserPerDayCounts).length;
  const distinctUsers = new Set(
    Object.values(messageCapture.perUserPerDayCounts).flatMap((perUser) => Object.keys(perUser)),
  ).size;

  console.log(
    `[discord-server-metrics] guild=${cli.guildId} snapshot=${snapshotKey} total_users=${exactTotalUsers} approximate_total_users=${counts.totalUsers} total_messages=${cli.skipMessages ? "skipped" : messageTotals.total_messages} public_total_messages=${cli.skipMessages ? "skipped" : messageTotals.public_total_messages} private_total_messages=${cli.skipMessages ? "skipped" : messageTotals.private_total_messages} online_users=${counts.onlineUsers ?? "n/a"} join_days=${Object.keys(memberJoinCounts).length} message_days=${cli.skipMessages ? "skipped" : Object.keys(messageCapture.perDayCounts).length} user_message_days=${cli.skipMessages ? "skipped" : userDaysWithMessages} distinct_message_users=${cli.skipMessages ? "skipped" : distinctUsers} request_delay_ms=${REQUEST_DELAY_MS} reset_history=${cli.resetHistory} skip_messages=${cli.skipMessages}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
