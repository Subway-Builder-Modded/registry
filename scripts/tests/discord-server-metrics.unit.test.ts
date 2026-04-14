import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscordServerByDayCsvRows,
  buildDiscordUsersByDayCsvRows,
  createEmptyDiscordServerMetricsHistory,
  toHourBucketIso,
  upsertDiscordServerMetricsSnapshot,
  updateDiscordServerUserDays,
} from "../lib/discord-server-metrics.js";

test("upsertDiscordServerMetricsSnapshot is idempotent within the same hour bucket", () => {
  const history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");
  const bucket = toHourBucketIso(new Date("2026-04-14T03:27:10.000Z"));

  const first = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: bucket,
    snapshot: {
      captured_at: bucket,
      total_users: 100,
      online_users: 25,
    },
    updatedAt: "2026-04-14T03:27:10.000Z",
  });

  const second = upsertDiscordServerMetricsSnapshot({
    history: first,
    snapshotKey: bucket,
    snapshot: {
      captured_at: bucket,
      total_users: 101,
      online_users: 26,
    },
    updatedAt: "2026-04-14T03:40:00.000Z",
  });

  assert.equal(Object.keys(second.snapshots).length, 1);
  assert.equal(second.snapshots[bucket]?.total_users, 101);
  assert.equal(second.snapshots[bucket]?.online_users, 26);
});

test("buildDiscordServerByDayCsvRows keeps the latest snapshot per UTC day", () => {
  let history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-10T01:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-10T01:00:00.000Z",
      total_users: 150,
      online_users: 40,
    },
  });

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-10T23:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-10T23:00:00.000Z",
      total_users: 155,
      online_users: 42,
    },
  });

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-11T04:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-11T04:00:00.000Z",
      total_users: 160,
      online_users: 45,
    },
  });

  assert.deepEqual(buildDiscordServerByDayCsvRows(history), [
    { date: "2026-04-10", total_users: 155 },
    { date: "2026-04-11", total_users: 160 },
  ]);
});

test("updateDiscordServerUserDays backfills current members by join date on first capture", () => {
  const history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  const updated = updateDiscordServerUserDays({
    history,
    memberJoinCounts: {
      "2026-04-10": 2,
      "2026-04-11": 3,
    },
    captureDate: "2026-04-14",
    updatedAt: "2026-04-14T01:00:00.000Z",
  });

  assert.deepEqual(updated.user_days, {
    "2026-04-10": { users_joined: 2, users_left: 0 },
    "2026-04-11": { users_joined: 3, users_left: 0 },
  });
  assert.deepEqual(updated.member_join_counts, {
    "2026-04-10": 2,
    "2026-04-11": 3,
  });
});

test("buildDiscordUsersByDayCsvRows derives joined and left counts across captures", () => {
  let history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-14T00:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-14T00:00:00.000Z",
      total_users: 3,
      online_users: 1,
    },
  });

  history = updateDiscordServerUserDays({
    history,
    memberJoinCounts: {
      "2026-04-10": 1,
      "2026-04-11": 2,
    },
    captureDate: "2026-04-14",
  });

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-15T00:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-15T00:00:00.000Z",
      total_users: 3,
      online_users: 1,
    },
  });

  history = updateDiscordServerUserDays({
    history,
    memberJoinCounts: {
      "2026-04-10": 1,
      "2026-04-11": 1,
      "2026-04-15": 2,
    },
    captureDate: "2026-04-15",
  });

  assert.deepEqual(buildDiscordUsersByDayCsvRows(history), [
    { date: "2026-04-10", total_users: 1, users_joined: 1, users_left: 0 },
    { date: "2026-04-11", total_users: 3, users_joined: 2, users_left: 0 },
    { date: "2026-04-14", total_users: 3, users_joined: 0, users_left: 0 },
    { date: "2026-04-15", total_users: 3, users_joined: 2, users_left: 1 },
  ]);
});
