import { pathToFileURL } from "node:url";
import { fetchWithTimeout } from "./lib/http.js";
import {
  createEmptyDiscordServerMetricsHistory,
  DEFAULT_DISCORD_SERVER_GUILD_ID,
  loadDiscordServerMetricsHistory,
  toDateKey,
  toHourBucketIso,
  upsertDiscordServerMetricsSnapshot,
  updateDiscordServerUserDays,
  writeDiscordServerMetricsHistory,
} from "./lib/discord-server-metrics.js";
import { getNonEmptyEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const FETCH_TIMEOUT_MS = 45_000;

interface CliArgs {
  repoRoot: string;
  guildId: string;
  token: string;
  resetHistory: boolean;
}

interface DiscordGuildCountsResponse {
  id?: unknown;
  approximate_member_count?: unknown;
  approximate_presence_count?: unknown;
}

interface DiscordGuildMemberApiResponse {
  joined_at?: unknown;
  user?: {
    id?: unknown;
  } | null;
}

function parseArgs(argv: string[]): CliArgs {
  let resetHistory = false;

  for (const arg of argv) {
    if (arg === "--reset-history") {
      resetHistory = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    repoRoot: process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname),
    guildId: (getNonEmptyEnv("DISCORD_SERVER_GUILD_ID") ?? DEFAULT_DISCORD_SERVER_GUILD_ID).trim(),
    token: (getNonEmptyEnv("DISCORD_BOT_TOKEN") ?? "").trim(),
    resetHistory,
  };
}

async function fetchGuildCounts(guildId: string, token: string): Promise<{
  totalUsers: number;
  onlineUsers: number | null;
}> {
  const response = await fetchWithTimeout(
    fetch,
    `${DISCORD_API_BASE}/guilds/${guildId}?with_counts=true`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bot ${token}`,
        "User-Agent": "the-railyard-discord-metrics",
      },
    },
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      heartbeatPrefix: "[discord-server-metrics]",
      heartbeatLabel: `fetch-guild guild=${guildId}`,
    },
  );

  if (!response.ok) {
    throw new Error(`Discord API returned HTTP ${response.status}`);
  }

  const payload = await response.json() as DiscordGuildCountsResponse;
  const totalUsers = typeof payload.approximate_member_count === "number"
    && Number.isFinite(payload.approximate_member_count)
    && payload.approximate_member_count >= 0
    ? payload.approximate_member_count
    : null;

  if (totalUsers === null) {
    throw new Error("Discord guild response missing approximate_member_count");
  }

  const onlineUsers = typeof payload.approximate_presence_count === "number"
    && Number.isFinite(payload.approximate_presence_count)
    && payload.approximate_presence_count >= 0
    ? payload.approximate_presence_count
    : null;

  return { totalUsers, onlineUsers };
}

async function fetchGuildMemberJoinCounts(guildId: string, token: string): Promise<Record<string, number>> {
  const joinCounts: Record<string, number> = {};
  let after = "0";

  while (true) {
    const response = await fetchWithTimeout(
      fetch,
      `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000&after=${encodeURIComponent(after)}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bot ${token}`,
          "User-Agent": "the-railyard-discord-metrics",
        },
      },
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        heartbeatPrefix: "[discord-server-metrics]",
        heartbeatLabel: `fetch-members guild=${guildId} after=${after}`,
      },
    );

    if (response.status === 403) {
      throw new Error(
        "Discord API returned HTTP 403 when listing guild members. Enable Server Members Intent for the bot application.",
      );
    }
    if (!response.ok) {
      throw new Error(`Discord member list API returned HTTP ${response.status}`);
    }

    const payload = await response.json() as DiscordGuildMemberApiResponse[];
    if (!Array.isArray(payload)) {
      throw new Error("Discord member list response was not an array.");
    }

    let lastUserId = after;
    for (const member of payload) {
      if (member && typeof member === "object") {
        const dateKey = typeof member.joined_at === "string" ? toDateKey(member.joined_at) : null;
        if (dateKey) {
          joinCounts[dateKey] = (joinCounts[dateKey] ?? 0) + 1;
        }

        const userId = member.user && typeof member.user === "object" && typeof member.user.id === "string"
          ? member.user.id
          : null;
        if (userId) {
          lastUserId = userId;
        }
      }
    }

    if (payload.length < 1000) {
      break;
    }
    if (lastUserId === after) {
      throw new Error("Discord member pagination did not advance.");
    }
    after = lastUserId;
  }

  return joinCounts;
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.token === "") {
    console.log(
      "[discord-server-metrics] Missing DISCORD_BOT_TOKEN; skipping capture.",
    );
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const snapshotKey = toHourBucketIso(now);
  const captureDate = nowIso.slice(0, 10);
  const counts = await fetchGuildCounts(cli.guildId, cli.token);
  const memberJoinCounts = await fetchGuildMemberJoinCounts(cli.guildId, cli.token);
  const exactTotalUsers = Object.values(memberJoinCounts).reduce((sum, count) => sum + count, 0);
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
    },
    updatedAt: nowIso,
  });
  const history = updateDiscordServerUserDays({
    history: historyWithSnapshot,
    memberJoinCounts,
    captureDate,
    updatedAt: nowIso,
  });

  writeDiscordServerMetricsHistory(cli.repoRoot, history);

  console.log(
    `[discord-server-metrics] guild=${cli.guildId} snapshot=${snapshotKey} total_users=${exactTotalUsers} approximate_total_users=${counts.totalUsers} online_users=${counts.onlineUsers ?? "n/a"} join_days=${Object.keys(memberJoinCounts).length} reset_history=${cli.resetHistory}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
