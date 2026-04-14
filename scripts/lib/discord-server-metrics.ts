import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isObject, sortObjectByKeys, toFiniteNonNegativeNumber } from "./json-utils.js";

const DISCORD_SERVER_METRICS_HISTORY_FILE = ["history", "discord_server_metrics.json"] as const;
export const DEFAULT_DISCORD_SERVER_GUILD_ID = "1476290196139147376";

export interface DiscordServerSnapshot {
  captured_at: string;
  total_users: number;
  online_users: number | null;
  total_messages: number | null;
  public_total_messages: number | null;
  private_total_messages: number | null;
}

export interface DiscordUserDayMetrics {
  users_joined: number;
  users_left: number;
}

export interface DiscordMessageCreationCounts {
  total_messages: number;
  public_total_messages: number;
  private_total_messages: number;
}

export interface DiscordMessageDayMetrics {
  messages_created: number;
  messages_deleted: number;
  public_messages_created: number;
  public_messages_deleted: number;
  private_messages_created: number;
  private_messages_deleted: number;
}

export interface DiscordUserMessageCounts {
  total_messages: number;
  public_messages: number;
  private_messages: number;
}

export interface DiscordServerMetricsHistory {
  schema_version: 4;
  guild_id: string;
  updated_at: string;
  snapshots: Record<string, DiscordServerSnapshot>;
  member_join_counts: Record<string, number>;
  user_days: Record<string, DiscordUserDayMetrics>;
  message_creation_counts: Record<string, DiscordMessageCreationCounts>;
  message_days: Record<string, DiscordMessageDayMetrics>;
  message_user_counts: Record<string, Record<string, DiscordUserMessageCounts>>;
  message_user_labels: Record<string, string>;
}

export interface DiscordServerByDayCsvRow {
  date: string;
  total_users: number;
  users_joined: number;
  users_left: number;
  total_messages: number;
  messages_created: number;
  messages_deleted: number;
  public_total_messages: number;
  public_messages_created: number;
  public_messages_deleted: number;
  private_total_messages: number;
  private_messages_created: number;
  private_messages_deleted: number;
}

export interface DiscordUserMessageByDayCsvRow {
  date: string;
  user_id: string;
  user_name: string;
  total_messages: number;
  public_messages: number;
  private_messages: number;
}

function emptyMessageCreationCounts(): DiscordMessageCreationCounts {
  return {
    total_messages: 0,
    public_total_messages: 0,
    private_total_messages: 0,
  };
}

function emptyMessageDayMetrics(): DiscordMessageDayMetrics {
  return {
    messages_created: 0,
    messages_deleted: 0,
    public_messages_created: 0,
    public_messages_deleted: 0,
    private_messages_created: 0,
    private_messages_deleted: 0,
  };
}

function emptyUserMessageCounts(): DiscordUserMessageCounts {
  return {
    total_messages: 0,
    public_messages: 0,
    private_messages: 0,
  };
}

export function getDiscordServerMetricsHistoryPath(repoRoot: string): string {
  return resolve(repoRoot, ...DISCORD_SERVER_METRICS_HISTORY_FILE);
}

export function toHourBucketIso(date: Date): string {
  const bucket = new Date(date.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function toDateKey(isoValue: string): string | null {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeMessageCreationCounts(value: unknown): DiscordMessageCreationCounts | null {
  if (!isObject(value)) return null;
  const totalMessages = toFiniteNonNegativeNumber(value.total_messages);
  const publicTotalMessages = toFiniteNonNegativeNumber(value.public_total_messages);
  const privateTotalMessages = toFiniteNonNegativeNumber(value.private_total_messages);
  if (totalMessages === null || publicTotalMessages === null || privateTotalMessages === null) {
    return null;
  }
  return {
    total_messages: totalMessages,
    public_total_messages: publicTotalMessages,
    private_total_messages: privateTotalMessages,
  };
}

function normalizeMessageDayMetrics(value: unknown): DiscordMessageDayMetrics | null {
  if (!isObject(value)) return null;
  return {
    messages_created: toFiniteNonNegativeNumber(value.messages_created) ?? 0,
    messages_deleted: toFiniteNonNegativeNumber(value.messages_deleted) ?? 0,
    public_messages_created: toFiniteNonNegativeNumber(value.public_messages_created) ?? 0,
    public_messages_deleted: toFiniteNonNegativeNumber(value.public_messages_deleted) ?? 0,
    private_messages_created: toFiniteNonNegativeNumber(value.private_messages_created) ?? 0,
    private_messages_deleted: toFiniteNonNegativeNumber(value.private_messages_deleted) ?? 0,
  };
}

function normalizeUserMessageCounts(value: unknown): DiscordUserMessageCounts | null {
  if (!isObject(value)) return null;
  return {
    total_messages: toFiniteNonNegativeNumber(value.total_messages) ?? 0,
    public_messages: toFiniteNonNegativeNumber(value.public_messages) ?? 0,
    private_messages: toFiniteNonNegativeNumber(value.private_messages) ?? 0,
  };
}

export function createEmptyDiscordServerMetricsHistory(
  guildId = DEFAULT_DISCORD_SERVER_GUILD_ID,
  nowIso = new Date().toISOString(),
): DiscordServerMetricsHistory {
  return {
    schema_version: 4,
    guild_id: guildId,
    updated_at: nowIso,
    snapshots: {},
    member_join_counts: {},
    user_days: {},
    message_creation_counts: {},
    message_days: {},
    message_user_counts: {},
    message_user_labels: {},
  };
}

export function normalizeDiscordServerMetricsHistory(
  value: unknown,
  fallbackGuildId = DEFAULT_DISCORD_SERVER_GUILD_ID,
  nowIso = new Date().toISOString(),
): DiscordServerMetricsHistory {
  if (!isObject(value) || (value.schema_version !== 1 && value.schema_version !== 2 && value.schema_version !== 3 && value.schema_version !== 4)) {
    return createEmptyDiscordServerMetricsHistory(fallbackGuildId, nowIso);
  }

  const snapshots: Record<string, DiscordServerSnapshot> = {};
  if (isObject(value.snapshots)) {
    for (const [snapshotKey, snapshotValue] of Object.entries(value.snapshots)) {
      if (!isObject(snapshotValue)) continue;
      const totalUsers = toFiniteNonNegativeNumber(snapshotValue.total_users);
      if (totalUsers === null) continue;
      const onlineUsers = snapshotValue.online_users === null
        ? null
        : toFiniteNonNegativeNumber(snapshotValue.online_users);
      snapshots[snapshotKey] = {
        captured_at: typeof snapshotValue.captured_at === "string" && snapshotValue.captured_at.trim() !== ""
          ? snapshotValue.captured_at
          : snapshotKey,
        total_users: totalUsers,
        online_users: onlineUsers,
        total_messages: value.schema_version >= 3
          ? (snapshotValue.total_messages === null ? null : toFiniteNonNegativeNumber(snapshotValue.total_messages))
          : null,
        public_total_messages: value.schema_version >= 3
          ? (snapshotValue.public_total_messages === null ? null : toFiniteNonNegativeNumber(snapshotValue.public_total_messages))
          : null,
        private_total_messages: value.schema_version >= 3
          ? (snapshotValue.private_total_messages === null ? null : toFiniteNonNegativeNumber(snapshotValue.private_total_messages))
          : null,
      };
    }
  }

  const memberJoinCounts: Record<string, number> = {};
  if (isObject(value.member_join_counts)) {
    for (const [dateKey, countValue] of Object.entries(value.member_join_counts)) {
      const count = toFiniteNonNegativeNumber(countValue);
      if (count === null) continue;
      memberJoinCounts[dateKey] = count;
    }
  }

  const userDays: Record<string, DiscordUserDayMetrics> = {};
  if (isObject(value.user_days)) {
    for (const [dateKey, dayValue] of Object.entries(value.user_days)) {
      if (!isObject(dayValue)) continue;
      userDays[dateKey] = {
        users_joined: toFiniteNonNegativeNumber(dayValue.users_joined) ?? 0,
        users_left: toFiniteNonNegativeNumber(dayValue.users_left) ?? 0,
      };
    }
  }

  const messageCreationCounts: Record<string, DiscordMessageCreationCounts> = {};
  if (isObject(value.message_creation_counts)) {
    for (const [dateKey, dayValue] of Object.entries(value.message_creation_counts)) {
      const counts = normalizeMessageCreationCounts(dayValue);
      if (!counts) continue;
      messageCreationCounts[dateKey] = counts;
    }
  }

  const messageDays: Record<string, DiscordMessageDayMetrics> = {};
  if (isObject(value.message_days)) {
    for (const [dateKey, dayValue] of Object.entries(value.message_days)) {
      const metrics = normalizeMessageDayMetrics(dayValue);
      if (!metrics) continue;
      messageDays[dateKey] = metrics;
    }
  }

  const messageUserCounts: Record<string, Record<string, DiscordUserMessageCounts>> = {};
  if (isObject(value.message_user_counts)) {
    for (const [dateKey, rawPerUser] of Object.entries(value.message_user_counts)) {
      if (!isObject(rawPerUser)) continue;
      const perUser: Record<string, DiscordUserMessageCounts> = {};
      for (const [userId, rawCounts] of Object.entries(rawPerUser)) {
        const counts = normalizeUserMessageCounts(rawCounts);
        if (!counts) continue;
        perUser[userId] = counts;
      }
      messageUserCounts[dateKey] = sortObjectByKeys(perUser);
    }
  }

  const messageUserLabels: Record<string, string> = {};
  if (isObject(value.message_user_labels)) {
    for (const [userId, rawLabel] of Object.entries(value.message_user_labels)) {
      if (typeof rawLabel !== "string" || rawLabel.trim() === "") continue;
      messageUserLabels[userId] = rawLabel.trim();
    }
  }

  return {
    schema_version: 4,
    guild_id: typeof value.guild_id === "string" && value.guild_id.trim() !== ""
      ? value.guild_id
      : fallbackGuildId,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    snapshots: sortObjectByKeys(snapshots),
    member_join_counts: sortObjectByKeys(memberJoinCounts),
    user_days: sortObjectByKeys(userDays),
    message_creation_counts: sortObjectByKeys(messageCreationCounts),
    message_days: sortObjectByKeys(messageDays),
    message_user_counts: sortObjectByKeys(messageUserCounts),
    message_user_labels: sortObjectByKeys(messageUserLabels),
  };
}

export function loadDiscordServerMetricsHistory(
  repoRoot: string,
  fallbackGuildId = DEFAULT_DISCORD_SERVER_GUILD_ID,
  nowIso = new Date().toISOString(),
): DiscordServerMetricsHistory {
  const path = getDiscordServerMetricsHistoryPath(repoRoot);
  if (!existsSync(path)) {
    return createEmptyDiscordServerMetricsHistory(fallbackGuildId, nowIso);
  }
  return normalizeDiscordServerMetricsHistory(
    JSON.parse(readFileSync(path, "utf-8")) as unknown,
    fallbackGuildId,
    nowIso,
  );
}

export function writeDiscordServerMetricsHistory(
  repoRoot: string,
  history: DiscordServerMetricsHistory,
): void {
  writeFileSync(
    getDiscordServerMetricsHistoryPath(repoRoot),
    `${JSON.stringify(history, null, 2)}\n`,
    "utf-8",
  );
}

export function upsertDiscordServerMetricsSnapshot(params: {
  history: DiscordServerMetricsHistory;
  snapshotKey: string;
  snapshot: DiscordServerSnapshot;
  updatedAt?: string;
}): DiscordServerMetricsHistory {
  const nextSnapshots = {
    ...params.history.snapshots,
    [params.snapshotKey]: {
      captured_at: params.snapshot.captured_at,
      total_users: params.snapshot.total_users,
      online_users: params.snapshot.online_users,
      total_messages: params.snapshot.total_messages,
      public_total_messages: params.snapshot.public_total_messages,
      private_total_messages: params.snapshot.private_total_messages,
    },
  };

  return {
    schema_version: 4,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.snapshot.captured_at,
    snapshots: sortObjectByKeys(nextSnapshots),
    member_join_counts: params.history.member_join_counts,
    user_days: params.history.user_days,
    message_creation_counts: params.history.message_creation_counts,
    message_days: params.history.message_days,
    message_user_counts: params.history.message_user_counts,
    message_user_labels: params.history.message_user_labels,
  };
}

function buildLatestSnapshotByDay(
  history: DiscordServerMetricsHistory,
): Map<string, { snapshotKey: string; snapshot: DiscordServerSnapshot }> {
  const latestSnapshotByDay = new Map<string, { snapshotKey: string; snapshot: DiscordServerSnapshot }>();

  for (const [snapshotKey, snapshot] of Object.entries(history.snapshots)) {
    const dateKey = toDateKey(snapshotKey);
    if (!dateKey) continue;
    const existing = latestSnapshotByDay.get(dateKey);
    if (!existing || Date.parse(snapshotKey) > Date.parse(existing.snapshotKey)) {
      latestSnapshotByDay.set(dateKey, { snapshotKey, snapshot });
    }
  }

  return latestSnapshotByDay;
}

export function updateDiscordServerUserDays(params: {
  history: DiscordServerMetricsHistory;
  memberJoinCounts: Record<string, number>;
  captureDate: string;
  updatedAt?: string;
}): DiscordServerMetricsHistory {
  const previousCounts = params.history.member_join_counts;
  const nextCounts = sortObjectByKeys(params.memberJoinCounts);
  const nextUserDays: Record<string, DiscordUserDayMetrics> = {
    ...params.history.user_days,
  };

  if (Object.keys(previousCounts).length === 0 && Object.keys(params.history.user_days).length === 0) {
    for (const [dateKey, count] of Object.entries(nextCounts)) {
      nextUserDays[dateKey] = {
        users_joined: count,
        users_left: 0,
      };
    }
  } else {
    const allDateKeys = new Set<string>([
      ...Object.keys(previousCounts),
      ...Object.keys(nextCounts),
    ]);

    let usersLeftToday = 0;
    for (const dateKey of allDateKeys) {
      const previousCount = previousCounts[dateKey] ?? 0;
      const nextCount = nextCounts[dateKey] ?? 0;
      if (nextCount > previousCount) {
        const entry = nextUserDays[dateKey] ?? { users_joined: 0, users_left: 0 };
        nextUserDays[dateKey] = {
          users_joined: entry.users_joined + (nextCount - previousCount),
          users_left: entry.users_left,
        };
      } else if (previousCount > nextCount) {
        usersLeftToday += previousCount - nextCount;
      }
    }

    if (usersLeftToday > 0) {
      const entry = nextUserDays[params.captureDate] ?? { users_joined: 0, users_left: 0 };
      nextUserDays[params.captureDate] = {
        users_joined: entry.users_joined,
        users_left: entry.users_left + usersLeftToday,
      };
    }
  }

  return {
    schema_version: 4,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.history.updated_at,
    snapshots: params.history.snapshots,
    member_join_counts: nextCounts,
    user_days: sortObjectByKeys(nextUserDays),
    message_creation_counts: params.history.message_creation_counts,
    message_days: params.history.message_days,
    message_user_counts: params.history.message_user_counts,
    message_user_labels: params.history.message_user_labels,
  };
}

export function updateDiscordServerMessageDays(params: {
  history: DiscordServerMetricsHistory;
  messageCreationCounts: Record<string, DiscordMessageCreationCounts>;
  captureDate: string;
  updatedAt?: string;
}): DiscordServerMetricsHistory {
  const previousCounts = params.history.message_creation_counts;
  const nextCounts = sortObjectByKeys(params.messageCreationCounts);
  const nextMessageDays: Record<string, DiscordMessageDayMetrics> = {
    ...params.history.message_days,
  };

  if (Object.keys(previousCounts).length === 0 && Object.keys(params.history.message_days).length === 0) {
    for (const [dateKey, count] of Object.entries(nextCounts)) {
      nextMessageDays[dateKey] = {
        messages_created: count.total_messages,
        messages_deleted: 0,
        public_messages_created: count.public_total_messages,
        public_messages_deleted: 0,
        private_messages_created: count.private_total_messages,
        private_messages_deleted: 0,
      };
    }
  } else {
    const allDateKeys = new Set<string>([
      ...Object.keys(previousCounts),
      ...Object.keys(nextCounts),
    ]);

    let totalMessagesDeletedToday = 0;
    let publicMessagesDeletedToday = 0;
    let privateMessagesDeletedToday = 0;

    for (const dateKey of allDateKeys) {
      const previousCount = previousCounts[dateKey] ?? emptyMessageCreationCounts();
      const nextCount = nextCounts[dateKey] ?? emptyMessageCreationCounts();
      const createdDelta = {
        total_messages: Math.max(0, nextCount.total_messages - previousCount.total_messages),
        public_total_messages: Math.max(0, nextCount.public_total_messages - previousCount.public_total_messages),
        private_total_messages: Math.max(0, nextCount.private_total_messages - previousCount.private_total_messages),
      };
      const deletedDelta = {
        total_messages: Math.max(0, previousCount.total_messages - nextCount.total_messages),
        public_total_messages: Math.max(0, previousCount.public_total_messages - nextCount.public_total_messages),
        private_total_messages: Math.max(0, previousCount.private_total_messages - nextCount.private_total_messages),
      };

      if (
        createdDelta.total_messages > 0
        || createdDelta.public_total_messages > 0
        || createdDelta.private_total_messages > 0
      ) {
        const entry = nextMessageDays[dateKey] ?? emptyMessageDayMetrics();
        nextMessageDays[dateKey] = {
          messages_created: entry.messages_created + createdDelta.total_messages,
          messages_deleted: entry.messages_deleted,
          public_messages_created: entry.public_messages_created + createdDelta.public_total_messages,
          public_messages_deleted: entry.public_messages_deleted,
          private_messages_created: entry.private_messages_created + createdDelta.private_total_messages,
          private_messages_deleted: entry.private_messages_deleted,
        };
      }

      totalMessagesDeletedToday += deletedDelta.total_messages;
      publicMessagesDeletedToday += deletedDelta.public_total_messages;
      privateMessagesDeletedToday += deletedDelta.private_total_messages;
    }

    if (totalMessagesDeletedToday > 0 || publicMessagesDeletedToday > 0 || privateMessagesDeletedToday > 0) {
      const entry = nextMessageDays[params.captureDate] ?? emptyMessageDayMetrics();
      nextMessageDays[params.captureDate] = {
        messages_created: entry.messages_created,
        messages_deleted: entry.messages_deleted + totalMessagesDeletedToday,
        public_messages_created: entry.public_messages_created,
        public_messages_deleted: entry.public_messages_deleted + publicMessagesDeletedToday,
        private_messages_created: entry.private_messages_created,
        private_messages_deleted: entry.private_messages_deleted + privateMessagesDeletedToday,
      };
    }
  }

  return {
    schema_version: 4,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.history.updated_at,
    snapshots: params.history.snapshots,
    member_join_counts: params.history.member_join_counts,
    user_days: params.history.user_days,
    message_creation_counts: nextCounts,
    message_days: sortObjectByKeys(nextMessageDays),
    message_user_counts: params.history.message_user_counts,
    message_user_labels: params.history.message_user_labels,
  };
}

export function replaceDiscordServerMessageUserCounts(params: {
  history: DiscordServerMetricsHistory;
  messageUserCounts: Record<string, Record<string, DiscordUserMessageCounts>>;
  messageUserLabels: Record<string, string>;
  updatedAt?: string;
}): DiscordServerMetricsHistory {
  const normalizedCounts: Record<string, Record<string, DiscordUserMessageCounts>> = {};
  for (const [dateKey, rawPerUser] of Object.entries(params.messageUserCounts)) {
    const perUser: Record<string, DiscordUserMessageCounts> = {};
    for (const [userId, counts] of Object.entries(rawPerUser)) {
      perUser[userId] = {
        total_messages: counts.total_messages,
        public_messages: counts.public_messages,
        private_messages: counts.private_messages,
      };
    }
    normalizedCounts[dateKey] = sortObjectByKeys(perUser);
  }

  return {
    schema_version: 4,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.history.updated_at,
    snapshots: params.history.snapshots,
    member_join_counts: params.history.member_join_counts,
    user_days: params.history.user_days,
    message_creation_counts: params.history.message_creation_counts,
    message_days: params.history.message_days,
    message_user_counts: sortObjectByKeys(normalizedCounts),
    message_user_labels: sortObjectByKeys(
      Object.fromEntries(
        Object.entries(params.messageUserLabels)
          .filter(([, label]) => typeof label === "string" && label.trim() !== "")
          .map(([userId, label]) => [userId, label.trim()]),
      ),
    ),
  };
}

export function buildDiscordServerByDayCsvRows(
  history: DiscordServerMetricsHistory,
): DiscordServerByDayCsvRow[] {
  const latestSnapshotsByDay = buildLatestSnapshotByDay(history);
  const allDateKeys = new Set<string>([
    ...latestSnapshotsByDay.keys(),
    ...Object.keys(history.user_days),
    ...Object.keys(history.message_days),
  ]);

  let runningUsersTotal = 0;
  let runningMessagesTotal = 0;
  let runningPublicMessagesTotal = 0;
  let runningPrivateMessagesTotal = 0;

  return [...allDateKeys]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const userMetrics = history.user_days[date] ?? { users_joined: 0, users_left: 0 };
      const messageMetrics = history.message_days[date] ?? emptyMessageDayMetrics();
      const snapshot = latestSnapshotsByDay.get(date)?.snapshot;

      const derivedUsersTotal = Math.max(0, runningUsersTotal + userMetrics.users_joined - userMetrics.users_left);
      const totalUsers = snapshot?.total_users ?? derivedUsersTotal;

      const derivedMessagesTotal = Math.max(0, runningMessagesTotal + messageMetrics.messages_created - messageMetrics.messages_deleted);
      const totalMessages = snapshot?.total_messages ?? derivedMessagesTotal;

      const derivedPublicMessagesTotal = Math.max(
        0,
        runningPublicMessagesTotal + messageMetrics.public_messages_created - messageMetrics.public_messages_deleted,
      );
      const publicTotalMessages = snapshot?.public_total_messages ?? derivedPublicMessagesTotal;

      const derivedPrivateMessagesTotal = Math.max(
        0,
        runningPrivateMessagesTotal + messageMetrics.private_messages_created - messageMetrics.private_messages_deleted,
      );
      const privateTotalMessages = snapshot?.private_total_messages ?? derivedPrivateMessagesTotal;

      runningUsersTotal = totalUsers;
      runningMessagesTotal = totalMessages ?? derivedMessagesTotal;
      runningPublicMessagesTotal = publicTotalMessages ?? derivedPublicMessagesTotal;
      runningPrivateMessagesTotal = privateTotalMessages ?? derivedPrivateMessagesTotal;

      return {
        date,
        total_users: totalUsers,
        users_joined: userMetrics.users_joined,
        users_left: userMetrics.users_left,
        total_messages: totalMessages ?? 0,
        messages_created: messageMetrics.messages_created,
        messages_deleted: messageMetrics.messages_deleted,
        public_total_messages: publicTotalMessages ?? 0,
        public_messages_created: messageMetrics.public_messages_created,
        public_messages_deleted: messageMetrics.public_messages_deleted,
        private_total_messages: privateTotalMessages ?? 0,
        private_messages_created: messageMetrics.private_messages_created,
        private_messages_deleted: messageMetrics.private_messages_deleted,
      };
    });
}

export function buildDiscordUserMessageByDayCsvRows(
  history: DiscordServerMetricsHistory,
  userLimit = 100,
  allowedDates?: Set<string>,
): DiscordUserMessageByDayCsvRow[] {
  const rows: DiscordUserMessageByDayCsvRow[] = [];
  const totalsByUser = new Map<string, number>();

  for (const [dateKey, perUser] of Object.entries(history.message_user_counts)) {
    if (allowedDates && !allowedDates.has(dateKey)) continue;
    for (const [userId, counts] of Object.entries(perUser)) {
      totalsByUser.set(userId, (totalsByUser.get(userId) ?? 0) + counts.total_messages);
    }
  }

  const topUsers = new Set(
    [...totalsByUser.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .slice(0, userLimit)
      .map(([userId]) => userId),
  );

  for (const [dateKey, perUser] of Object.entries(history.message_user_counts).sort(([a], [b]) => a.localeCompare(b))) {
    if (allowedDates && !allowedDates.has(dateKey)) continue;
    for (const [userId, counts] of Object.entries(perUser)) {
      if (!topUsers.has(userId)) continue;
      rows.push({
        date: dateKey,
        user_id: userId,
        user_name: history.message_user_labels[userId] ?? userId,
        total_messages: counts.total_messages,
        public_messages: counts.public_messages,
        private_messages: counts.private_messages,
      });
    }
  }

  return rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (b.total_messages !== a.total_messages) return b.total_messages - a.total_messages;
    return a.user_id.localeCompare(b.user_id);
  });
}
