import { parseRetryAfterMs } from "./discord-webhook.js";
import { fetchWithTimeout } from "./http.js";
import {
  type DiscordMessageCreationCounts,
  type DiscordUserMessageCounts,
  toDateKey,
} from "./discord-server-metrics.js";

export const DISCORD_API_BASE = "https://discord.com/api/v10";
export const FETCH_TIMEOUT_MS = 45_000;
export const REQUEST_DELAY_MS = 250;
export const MAX_429_RETRIES = 5;

export const PERMISSION_VIEW_CHANNEL = 1n << 10n;
export const PERMISSION_READ_MESSAGE_HISTORY = 1n << 16n;
export const PERMISSION_ADMINISTRATOR = 1n << 3n;

export const CHANNEL_TYPE_GUILD_TEXT = 0;
export const CHANNEL_TYPE_GUILD_ANNOUNCEMENT = 5;
export const CHANNEL_TYPE_ANNOUNCEMENT_THREAD = 10;
export const CHANNEL_TYPE_PUBLIC_THREAD = 11;
export const CHANNEL_TYPE_PRIVATE_THREAD = 12;
export const CHANNEL_TYPE_GUILD_FORUM = 15;
export const CHANNEL_TYPE_GUILD_MEDIA = 16;

export interface DiscordGuildCountsResponse {
  approximate_member_count?: unknown;
  approximate_presence_count?: unknown;
}

export interface DiscordCurrentUserResponse {
  id?: unknown;
}

export interface DiscordGuildMemberApiResponse {
  joined_at?: unknown;
  user?: {
    id?: unknown;
  } | null;
  roles?: unknown;
}

export interface DiscordRoleApiResponse {
  id?: unknown;
  permissions?: unknown;
}

export interface DiscordPermissionOverwriteApiResponse {
  id?: unknown;
  type?: unknown;
  allow?: unknown;
  deny?: unknown;
}

export interface DiscordChannelApiResponse {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  parent_id?: unknown;
  permission_overwrites?: unknown;
}

export interface DiscordThreadListResponse {
  threads?: unknown;
  has_more?: unknown;
}

export interface DiscordMessageApiResponse {
  id?: unknown;
  timestamp?: unknown;
  author?: {
    id?: unknown;
    username?: unknown;
    global_name?: unknown;
  } | null;
}

export interface PermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: bigint;
  deny: bigint;
}

export interface GuildChannel {
  id: string;
  type: number;
  name: string;
  parentId: string | null;
  permissionOverwrites: PermissionOverwrite[];
}

export interface BotGuildContext {
  guildId: string;
  botUserId: string;
  botRoleIds: string[];
  basePermissions: bigint;
  everyonePermissions: bigint;
  channelsById: Map<string, GuildChannel>;
}

export interface ChannelMessageCounts {
  perDayCounts: Record<string, DiscordMessageCreationCounts>;
  perUserPerDayCounts: Record<string, Record<string, DiscordUserMessageCounts>>;
  userLabels: Record<string, string>;
}

export function parseSnowflake(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function parseBigIntValue(value: unknown): bigint {
  if (typeof value === "string" && value.trim() !== "") {
    return BigInt(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(value);
  }
  return 0n;
}

export function hasPermission(permissions: bigint, flag: bigint): boolean {
  if ((permissions & PERMISSION_ADMINISTRATOR) === PERMISSION_ADMINISTRATOR) {
    return true;
  }
  return (permissions & flag) === flag;
}

export function normalizeGuildChannel(value: unknown): GuildChannel | null {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchDiscordResponse(url: string, token: string, heartbeatLabel: string): Promise<Response> {
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

export async function fetchDiscordJson<T>(url: string, token: string, heartbeatLabel: string): Promise<T> {
  const response = await fetchDiscordResponse(url, token, heartbeatLabel);

  if (!response.ok) {
    throw new Error(`Discord API returned HTTP ${response.status} for ${heartbeatLabel}`);
  }

  return await response.json() as T;
}

export async function fetchGuildCounts(guildId: string, token: string): Promise<{
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

export async function fetchBotGuildContext(guildId: string, token: string): Promise<BotGuildContext> {
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

export function applyOverwrites(
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

export function getChannelPermissions(context: BotGuildContext, channel: GuildChannel): bigint {
  return applyOverwrites(
    context.basePermissions,
    channel.permissionOverwrites,
    context.guildId,
    context.botRoleIds,
    context.botUserId,
  );
}

export function isPublicChannel(context: BotGuildContext, channel: GuildChannel): boolean {
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

export function isMessageContainerChannel(channel: GuildChannel): boolean {
  return channel.type === CHANNEL_TYPE_GUILD_TEXT
    || channel.type === CHANNEL_TYPE_GUILD_ANNOUNCEMENT
    || channel.type === CHANNEL_TYPE_PUBLIC_THREAD
    || channel.type === CHANNEL_TYPE_PRIVATE_THREAD
    || channel.type === CHANNEL_TYPE_ANNOUNCEMENT_THREAD;
}

export function isThreadParentChannel(channel: GuildChannel): boolean {
  return channel.type === CHANNEL_TYPE_GUILD_TEXT
    || channel.type === CHANNEL_TYPE_GUILD_ANNOUNCEMENT
    || channel.type === CHANNEL_TYPE_GUILD_FORUM
    || channel.type === CHANNEL_TYPE_GUILD_MEDIA;
}

export async function fetchGuildMemberJoinCounts(guildId: string, token: string): Promise<Record<string, number>> {
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

export async function fetchArchivedThreads(
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

export async function fetchReadableChannels(context: BotGuildContext, token: string): Promise<GuildChannel[]> {
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

export async function fetchChannelMessages(
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

    let lastMessageId: string | null = before;
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
