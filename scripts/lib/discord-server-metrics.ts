import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isObject, sortObjectByKeys, toFiniteNonNegativeNumber } from "./json-utils.js";

const DISCORD_SERVER_METRICS_HISTORY_FILE = ["history", "discord_server_metrics.json"] as const;
export const DEFAULT_DISCORD_SERVER_GUILD_ID = "1476290196139147376";

export interface DiscordServerSnapshot {
  captured_at: string;
  total_users: number;
  online_users: number | null;
}

export interface DiscordUserDayMetrics {
  users_joined: number;
  users_left: number;
}

export interface DiscordServerMetricsHistory {
  schema_version: 2;
  guild_id: string;
  updated_at: string;
  snapshots: Record<string, DiscordServerSnapshot>;
  member_join_counts: Record<string, number>;
  user_days: Record<string, DiscordUserDayMetrics>;
}

export interface DiscordServerByDayCsvRow {
  date: string;
  total_users: number;
}

export interface DiscordUsersByDayCsvRow {
  date: string;
  total_users: number;
  users_joined: number;
  users_left: number;
}

export function getDiscordServerMetricsHistoryPath(repoRoot: string): string {
  return resolve(repoRoot, ...DISCORD_SERVER_METRICS_HISTORY_FILE);
}

export function toHourBucketIso(date: Date): string {
  const bucket = new Date(date.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

export function createEmptyDiscordServerMetricsHistory(
  guildId = DEFAULT_DISCORD_SERVER_GUILD_ID,
  nowIso = new Date().toISOString(),
): DiscordServerMetricsHistory {
  return {
    schema_version: 2,
    guild_id: guildId,
    updated_at: nowIso,
    snapshots: {},
    member_join_counts: {},
    user_days: {},
  };
}

export function normalizeDiscordServerMetricsHistory(
  value: unknown,
  fallbackGuildId = DEFAULT_DISCORD_SERVER_GUILD_ID,
  nowIso = new Date().toISOString(),
): DiscordServerMetricsHistory {
  if (!isObject(value) || (value.schema_version !== 1 && value.schema_version !== 2)) {
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
      const usersJoined = toFiniteNonNegativeNumber(dayValue.users_joined) ?? 0;
      const usersLeft = toFiniteNonNegativeNumber(dayValue.users_left) ?? 0;
      userDays[dateKey] = {
        users_joined: usersJoined,
        users_left: usersLeft,
      };
    }
  }

  return {
    schema_version: 2,
    guild_id: typeof value.guild_id === "string" && value.guild_id.trim() !== ""
      ? value.guild_id
      : fallbackGuildId,
    updated_at: typeof value.updated_at === "string" && value.updated_at.trim() !== ""
      ? value.updated_at
      : nowIso,
    snapshots: sortObjectByKeys(snapshots),
    member_join_counts: sortObjectByKeys(memberJoinCounts),
    user_days: sortObjectByKeys(userDays),
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
    },
  };

  return {
    schema_version: 2,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.snapshot.captured_at,
    snapshots: sortObjectByKeys(nextSnapshots),
    member_join_counts: params.history.member_join_counts,
    user_days: params.history.user_days,
  };
}

export function toDateKey(isoValue: string): string | null {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
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

export function buildDiscordServerByDayCsvRows(
  history: DiscordServerMetricsHistory,
): DiscordServerByDayCsvRow[] {
  return [...buildLatestSnapshotByDay(history).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({
      date,
      total_users: entry.snapshot.total_users,
    }));
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
    schema_version: 2,
    guild_id: params.history.guild_id,
    updated_at: params.updatedAt ?? params.history.updated_at,
    snapshots: params.history.snapshots,
    member_join_counts: nextCounts,
    user_days: sortObjectByKeys(nextUserDays),
  };
}

export function buildDiscordUsersByDayCsvRows(
  history: DiscordServerMetricsHistory,
): DiscordUsersByDayCsvRow[] {
  const snapshotTotalsByDay = new Map<string, number>(
    [...buildLatestSnapshotByDay(history).entries()].map(([date, entry]) => [date, entry.snapshot.total_users]),
  );

  const allDateKeys = new Set<string>([
    ...Object.keys(history.user_days),
    ...snapshotTotalsByDay.keys(),
  ]);

  let runningTotal = 0;
  return [...allDateKeys]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const dayMetrics = history.user_days[date] ?? { users_joined: 0, users_left: 0 };
      const derivedTotal = Math.max(0, runningTotal + dayMetrics.users_joined - dayMetrics.users_left);
      const snapshotTotal = snapshotTotalsByDay.get(date);
      const totalUsers = snapshotTotal ?? derivedTotal;
      runningTotal = totalUsers;

      return {
        date,
        total_users: totalUsers,
        users_joined: dayMetrics.users_joined,
        users_left: dayMetrics.users_left,
      };
    });
}
