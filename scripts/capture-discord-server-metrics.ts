import { pathToFileURL } from "node:url";
import { fetchWithTimeout } from "./lib/http.js";
import {
  createEmptyDiscordServerMetricsHistory,
  DEFAULT_DISCORD_SERVER_GUILD_ID,
  type DiscordMessageCreationCounts,
  type DiscordUserMessageCounts,
  loadDiscordServerMetricsHistory,
  replaceDiscordServerMessageUserCounts,
  toDateKey,
  toHourBucketIso,
  updateDiscordServerMessageDays,
  updateDiscordServerUserDays,
  upsertDiscordServerMetricsSnapshot,
  writeDiscordServerMetricsHistory,
} from "./lib/discord-server-metrics.js";
import { getNonEmptyEnv, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const FETCH_TIMEOUT_MS = 45_000;
const REQUEST_DELAY_MS = 250;
const MAX_429_RETRIES = 5;

const PERMISSION_VIEW_CHANNEL = 1n << 10n;
const PERMISSION_READ_MESSAGE_HISTORY = 1n << 16n;
const PERMISSION_ADMINISTRATOR = 1n << 3n;

const CHANNEL_TYPE_GUILD_TEXT = 0;
const CHANNEL_TYPE_GUILD_ANNOUNCEMENT = 5;
const CHANNEL_TYPE_ANNOUNCEMENT_THREAD = 10;
const CHANNEL_TYPE_PUBLIC_THREAD = 11;
const CHANNEL_TYPE_PRIVATE_THREAD = 12;
const CHANNEL_TYPE_GUILD_FORUM = 15;
const CHANNEL_TYPE_GUILD_MEDIA = 16;

interface CliArgs {
  repoRoot: string;
  guildId: string;
  token: string;
  resetHistory: boolean;
  skipMessages: boolean;
}

interface DiscordGuildCountsResponse {
  approximate_member_count?: unknown;
  approximate_presence_count?: unknown;
}

interface DiscordCurrentUserResponse {
  id?: unknown;
}

interface DiscordGuildMemberApiResponse {
  joined_at?: unknown;
  user?: {
    id?: unknown;
  } | null;
  roles?: unknown;
}

interface DiscordRoleApiResponse {
  id?: unknown;
  permissions?: unknown;
}

interface DiscordPermissionOverwriteApiResponse {
  id?: unknown;
  type?: unknown;
  allow?: unknown;
  deny?: unknown;
}

interface DiscordChannelApiResponse {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  parent_id?: unknown;
  permission_overwrites?: unknown;
}

interface DiscordThreadListResponse {
  threads?: unknown;
  has_more?: unknown;
}

interface DiscordMessageApiResponse {
  id?: unknown;
  timestamp?: unknown;
  author?: {
    id?: unknown;
    username?: unknown;
    global_name?: unknown;
  } | null;
}

interface PermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

interface GuildChannel {
  id: string;
  type: number;
  name: string;
  parentId: string | null;
  permissionOverwrites: PermissionOverwrite[];
}

interface BotGuildContext {
  guildId: string;
  botUserId: string;
  botRoleIds: string[];
  basePermissions: bigint;
  everyonePermissions: bigint;
  channelsById: Map<string, GuildChannel>;
}

interface ChannelMessageCounts {
  perDayCounts: Record<string, DiscordMessageCreationCounts>;
  perUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>>;
  userLabels: Record<string, string>;
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

function parseSnowflake(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseBigIntValue(value: unknown): bigint {
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(value);
  }
  return 0n;
}

function hasPermission(permissions: bigint, flag: bigint): boolean {
  if ((permissions & PERMISSION_ADMINISTRATOR) === PERMISSION_ADMINISTRATOR) {
    return true;
  }
  return (permissions & flag) === flag;
}

function normalizeGuildChannel(value: unknown): GuildChannel | null {
  if (!value || typeof value !== "object") return null;
  const channel = value as DiscordChannelApiResponse;
  const id = parseSnowflake(channel.id);
  const type = typeof channel.type === "number" && Number.isInteger(channel.type) ? channel.type : null;
  if (!id || type === null) return null;

  const overwrites: PermissionOverwrite[] = Array.isArray(channel.permission_overwrites)
    ? channel.permission_overwrites
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const overwrite = entry as DiscordPermissionOverwriteApiResponse;
        const overwriteId = parseSnowflake(overwrite.id);
        const overwriteType = overwrite.type === 0 || overwrite.type === 1 ? overwrite.type : null;
        if (!overwriteId || overwriteType === null) return null;
        return {
          id: overwriteId,
          type: overwriteType,
          allow: parseBigIntValue(overwrite.allow),
          deny: parseBigIntValue(overwrite.deny),
        };
      })
      .filter((entry): entry is PermissionOverwrite => entry !== null)
    : [];

  return {
    id,
    type,
    name: typeof channel.name === "string" ? channel.name : id,
    parentId: parseSnowflake(channel.parent_id),
    permissionOverwrites: overwrites,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const retryAfter = (payload as { retry_after?: unknown }).retry_after;
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter) || retryAfter < 0) {
    return null;
  }
  if (retryAfter > 1000) {
    return Math.ceil(retryAfter);
  }
  return Math.ceil(retryAfter * 1000);
}

async function fetchDiscordResponse(url: string, token: string, heartbeatLabel: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(
      fetch,
      url,
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
        heartbeatLabel,
      },
    );

    if (response.status !== 429) {
      await sleep(REQUEST_DELAY_MS);
      return response;
    }

    let retryAfterMs = 5_000;
    try {
      retryAfterMs = parseRetryAfterMs(await response.json()) ?? retryAfterMs;
    } catch {
      retryAfterMs = 5_000;
    }

    if (attempt === MAX_429_RETRIES) {
      throw new Error(`Discord API kept returning HTTP 429 for ${heartbeatLabel}`);
    }

    console.warn(
      `[discord-server-metrics] rate limited for ${heartbeatLabel}; retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`,
    );
    await sleep(retryAfterMs + REQUEST_DELAY_MS);
  }

  throw new Error(`Discord API request failed for ${heartbeatLabel}`);
}

async function fetchDiscordJson<T>(url: string, token: string, heartbeatLabel: string): Promise<T> {
  const response = await fetchDiscordResponse(url, token, heartbeatLabel);

  if (!response.ok) {
    throw new Error(`Discord API returned HTTP ${response.status} for ${heartbeatLabel}`);
  }

  return await response.json() as T;
}

async function fetchGuildCounts(guildId: string, token: string): Promise<{
  totalUsers: number;
  onlineUsers: number | null;
}> {
  const payload = await fetchDiscordJson<DiscordGuildCountsResponse>(
    `${DISCORD_API_BASE}/guilds/${guildId}?with_counts=true`,
    token,
    `fetch-guild guild=${guildId}`,
  );

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

async function fetchBotGuildContext(guildId: string, token: string): Promise<BotGuildContext> {
  const currentUser = await fetchDiscordJson<DiscordCurrentUserResponse>(
    `${DISCORD_API_BASE}/users/@me`,
    token,
    "fetch-current-user",
  );
  const botUserId = parseSnowflake(currentUser.id);
  if (!botUserId) {
    throw new Error("Discord current user response missing bot id.");
  }

  const roles = await fetchDiscordJson<DiscordRoleApiResponse[]>(
    `${DISCORD_API_BASE}/guilds/${guildId}/roles`,
    token,
    `fetch-roles guild=${guildId}`,
  );
  const rolePermissions = new Map<string, bigint>();
  for (const role of roles) {
    const roleId = parseSnowflake(role.id);
    if (!roleId) continue;
    rolePermissions.set(roleId, parseBigIntValue(role.permissions));
  }

  const botMember = await fetchDiscordJson<DiscordGuildMemberApiResponse>(
    `${DISCORD_API_BASE}/guilds/${guildId}/members/${botUserId}`,
    token,
    `fetch-bot-member guild=${guildId}`,
  );
  const botRoleIds = Array.isArray(botMember.roles)
    ? botMember.roles
      .map((roleId) => parseSnowflake(roleId))
      .filter((roleId): roleId is string => roleId !== null)
    : [];

  let basePermissions = rolePermissions.get(guildId) ?? 0n;
  for (const roleId of botRoleIds) {
    basePermissions |= rolePermissions.get(roleId) ?? 0n;
  }

  const channels = await fetchDiscordJson<DiscordChannelApiResponse[]>(
    `${DISCORD_API_BASE}/guilds/${guildId}/channels`,
    token,
    `fetch-channels guild=${guildId}`,
  );
  const channelsById = new Map<string, GuildChannel>();
  for (const channelValue of channels) {
    const channel = normalizeGuildChannel(channelValue);
    if (!channel) continue;
    channelsById.set(channel.id, channel);
  }

  return {
    guildId,
    botUserId,
    botRoleIds,
    basePermissions,
    everyonePermissions: rolePermissions.get(guildId) ?? 0n,
    channelsById,
  };
}

function applyOverwrites(
  basePermissions: bigint,
  overwrites: PermissionOverwrite[],
  everyoneRoleId: string,
  roleIds: string[],
  memberId: string,
): bigint {
  let permissions = basePermissions;

  const everyoneOverwrite = overwrites.find((entry) => entry.type === 0 && entry.id === everyoneRoleId);
  if (everyoneOverwrite) {
    permissions &= ~everyoneOverwrite.deny;
    permissions |= everyoneOverwrite.allow;
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !roleIds.includes(overwrite.id)) continue;
    roleAllow |= overwrite.allow;
    roleDeny |= overwrite.deny;
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = overwrites.find((entry) => entry.type === 1 && entry.id === memberId);
  if (memberOverwrite) {
    permissions &= ~memberOverwrite.deny;
    permissions |= memberOverwrite.allow;
  }

  return permissions;
}

function getChannelPermissions(context: BotGuildContext, channel: GuildChannel): bigint {
  return applyOverwrites(
    context.basePermissions,
    channel.permissionOverwrites,
    context.guildId,
    context.botRoleIds,
    context.botUserId,
  );
}

function isPublicChannel(context: BotGuildContext, channel: GuildChannel): boolean {
  if (channel.type === CHANNEL_TYPE_PRIVATE_THREAD) {
    return false;
  }

  if (channel.type === CHANNEL_TYPE_PUBLIC_THREAD || channel.type === CHANNEL_TYPE_ANNOUNCEMENT_THREAD) {
    const parent = channel.parentId ? context.channelsById.get(channel.parentId) : undefined;
    if (!parent) return false;
    return isPublicChannel(context, parent);
  }

  const everyonePermissions = applyOverwrites(
    context.everyonePermissions,
    channel.permissionOverwrites,
    context.guildId,
    [],
    "",
  );
  return hasPermission(everyonePermissions, PERMISSION_VIEW_CHANNEL);
}

function isMessageContainerChannel(channel: GuildChannel): boolean {
  return channel.type === CHANNEL_TYPE_GUILD_TEXT
    || channel.type === CHANNEL_TYPE_GUILD_ANNOUNCEMENT
    || channel.type === CHANNEL_TYPE_PUBLIC_THREAD
    || channel.type === CHANNEL_TYPE_PRIVATE_THREAD
    || channel.type === CHANNEL_TYPE_ANNOUNCEMENT_THREAD;
}

function isThreadParentChannel(channel: GuildChannel): boolean {
  return channel.type === CHANNEL_TYPE_GUILD_TEXT
    || channel.type === CHANNEL_TYPE_GUILD_ANNOUNCEMENT
    || channel.type === CHANNEL_TYPE_GUILD_FORUM
    || channel.type === CHANNEL_TYPE_GUILD_MEDIA;
}

async function fetchGuildMemberJoinCounts(guildId: string, token: string): Promise<Record<string, number>> {
  const joinCounts: Record<string, number> = {};
  let after = "0";

  while (true) {
    const response = await fetchDiscordResponse(
      `${DISCORD_API_BASE}/guilds/${guildId}/members?limit=1000&after=${encodeURIComponent(after)}`,
      token,
      `fetch-members guild=${guildId} after=${after}`,
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
      const dateKey = typeof member.joined_at === "string" ? toDateKey(member.joined_at) : null;
      if (dateKey) {
        joinCounts[dateKey] = (joinCounts[dateKey] ?? 0) + 1;
      }

      const userId = parseSnowflake(member.user?.id);
      if (userId) {
        lastUserId = userId;
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

async function fetchArchivedThreads(
  path: string,
  token: string,
  heartbeatBase: string,
): Promise<GuildChannel[]> {
  const threads: GuildChannel[] = [];
  let before: string | null = null;

  while (true) {
    const url = new URL(`${DISCORD_API_BASE}${path}`);
    if (before) {
      url.searchParams.set("before", before);
    }
    url.searchParams.set("limit", "100");

    const response = await fetchDiscordResponse(
      url.toString(),
      token,
      `${heartbeatBase} before=${before ?? "none"}`,
    );

    if (response.status === 403 || response.status === 404) {
      return threads;
    }
    if (!response.ok) {
      throw new Error(`Discord archived threads API returned HTTP ${response.status}`);
    }

    const payload = await response.json() as DiscordThreadListResponse;
    const rawThreads = Array.isArray(payload.threads) ? payload.threads : [];
    const batch = rawThreads
      .map((thread) => normalizeGuildChannel(thread))
      .filter((thread): thread is GuildChannel => thread !== null);
    threads.push(...batch);

    if (batch.length === 0 || payload.has_more !== true) {
      break;
    }
    before = batch[batch.length - 1]?.id ?? null;
    if (!before) {
      break;
    }
  }

  return threads;
}

async function fetchReadableChannels(context: BotGuildContext, token: string): Promise<GuildChannel[]> {
  const channels = new Map<string, GuildChannel>();
  for (const channel of context.channelsById.values()) {
    channels.set(channel.id, channel);
  }

  const activeThreads = await fetchDiscordJson<DiscordThreadListResponse>(
    `${DISCORD_API_BASE}/guilds/${context.guildId}/threads/active`,
    token,
    `fetch-active-threads guild=${context.guildId}`,
  );
  for (const thread of Array.isArray(activeThreads.threads) ? activeThreads.threads : []) {
    const normalized = normalizeGuildChannel(thread);
    if (!normalized) continue;
    channels.set(normalized.id, normalized);
  }

  const threadParents = [...context.channelsById.values()].filter(isThreadParentChannel);
  for (const parent of threadParents) {
    const publicThreads = await fetchArchivedThreads(
      `/channels/${parent.id}/threads/archived/public`,
      token,
      `fetch-archived-public-threads channel=${parent.id}`,
    );
    for (const thread of publicThreads) {
      channels.set(thread.id, thread);
    }

    const privateThreads = await fetchArchivedThreads(
      `/channels/${parent.id}/threads/archived/private`,
      token,
      `fetch-archived-private-threads channel=${parent.id}`,
    );
    if (privateThreads.length > 0) {
      for (const thread of privateThreads) {
        channels.set(thread.id, thread);
      }
    } else {
      const joinedPrivateThreads = await fetchArchivedThreads(
        `/channels/${parent.id}/users/@me/threads/archived/private`,
        token,
        `fetch-joined-private-threads channel=${parent.id}`,
      );
      for (const thread of joinedPrivateThreads) {
        channels.set(thread.id, thread);
      }
    }
  }

  return [...channels.values()]
    .filter(isMessageContainerChannel)
    .filter((channel) => {
      const permissions = getChannelPermissions(context, channel);
      return hasPermission(permissions, PERMISSION_VIEW_CHANNEL)
        && hasPermission(permissions, PERMISSION_READ_MESSAGE_HISTORY);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchChannelMessages(
  context: BotGuildContext,
  channel: GuildChannel,
  token: string,
): Promise<ChannelMessageCounts> {
  const perDayCounts: Record<string, DiscordMessageCreationCounts> = {};
  const perUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>> = {};
  const userLabels: Record<string, string> = {};
  let before: string | null = null;
  const isPublic = isPublicChannel(context, channel);

  while (true) {
    const url = new URL(`${DISCORD_API_BASE}/channels/${channel.id}/messages`);
    url.searchParams.set("limit", "100");
    if (before) {
      url.searchParams.set("before", before);
    }

    const response = await fetchDiscordResponse(
      url.toString(),
      token,
      `fetch-messages channel=${channel.id} before=${before ?? "none"}`,
    );

    if (response.status === 403 || response.status === 404) {
      return { perDayCounts, perUserPerDayCounts, userLabels };
    }
    if (!response.ok) {
      throw new Error(`Discord messages API returned HTTP ${response.status} for channel ${channel.id}`);
    }

    const payload = await response.json() as DiscordMessageApiResponse[];
    if (!Array.isArray(payload)) {
      throw new Error(`Discord messages response was not an array for channel ${channel.id}`);
    }

    let lastMessageId = before;
    for (const message of payload) {
      const dateKey = typeof message.timestamp === "string" ? toDateKey(message.timestamp) : null;
      if (!dateKey) continue;

      const entry = perDayCounts[dateKey] ?? {
        total_messages: 0,
        public_total_messages: 0,
        private_total_messages: 0,
      };
      entry.total_messages += 1;
      if (isPublic) {
        entry.public_total_messages += 1;
      } else {
        entry.private_total_messages += 1;
      }
      perDayCounts[dateKey] = entry;

      const userId = parseSnowflake(message.author?.id);
      if (userId) {
        const labelParts = [
          typeof message.author?.global_name === "string" ? message.author.global_name.trim() : "",
          typeof message.author?.username === "string" ? message.author.username.trim() : "",
        ].filter((part) => part !== "");
        if (labelParts.length > 0) {
          userLabels[userId] = labelParts[0]!;
        }

        const perDayUserCounts = perUserPerDayCounts[dateKey] ?? {};
        const userCounts = perDayUserCounts[userId] ?? {
          total_messages: 0,
          public_messages: 0,
          private_messages: 0,
        };
        userCounts.total_messages += 1;
        if (isPublic) {
          userCounts.public_messages += 1;
        } else {
          userCounts.private_messages += 1;
        }
        perDayUserCounts[userId] = userCounts;
        perUserPerDayCounts[dateKey] = perDayUserCounts;
      }

      const messageId = parseSnowflake(message.id);
      if (messageId) {
        lastMessageId = messageId;
      }
    }

    if (payload.length < 100) {
      break;
    }
    if (!lastMessageId || lastMessageId === before) {
      throw new Error(`Discord message pagination did not advance for channel ${channel.id}`);
    }
    before = lastMessageId;
  }

  return { perDayCounts, perUserPerDayCounts, userLabels };
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
