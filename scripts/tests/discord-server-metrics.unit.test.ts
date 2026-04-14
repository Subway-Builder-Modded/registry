import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscordServerByDayCsvRows,
  buildDiscordUserMessageByDayCsvRows,
  createEmptyDiscordServerMetricsHistory,
  replaceDiscordServerMessageUserCounts,
  toHourBucketIso,
  updateDiscordServerMessageDays,
  updateDiscordServerUserDays,
  upsertDiscordServerMetricsSnapshot,
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
      total_messages: 400,
      public_total_messages: 300,
      private_total_messages: 100,
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
      total_messages: 405,
      public_total_messages: 301,
      private_total_messages: 104,
    },
    updatedAt: "2026-04-14T03:40:00.000Z",
  });

  assert.equal(Object.keys(second.snapshots).length, 1);
  assert.equal(second.snapshots[bucket]?.total_users, 101);
  assert.equal(second.snapshots[bucket]?.total_messages, 405);
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
});

test("updateDiscordServerMessageDays backfills current surviving messages on first capture", () => {
  const history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  const updated = updateDiscordServerMessageDays({
    history,
    messageCreationCounts: {
      "2026-04-10": {
        total_messages: 10,
        public_total_messages: 7,
        private_total_messages: 3,
      },
      "2026-04-11": {
        total_messages: 4,
        public_total_messages: 4,
        private_total_messages: 0,
      },
    },
    captureDate: "2026-04-14",
    updatedAt: "2026-04-14T01:00:00.000Z",
  });

  assert.deepEqual(updated.message_days, {
    "2026-04-10": {
      messages_created: 10,
      messages_deleted: 0,
      public_messages_created: 7,
      public_messages_deleted: 0,
      private_messages_created: 3,
      private_messages_deleted: 0,
    },
    "2026-04-11": {
      messages_created: 4,
      messages_deleted: 0,
      public_messages_created: 4,
      public_messages_deleted: 0,
      private_messages_created: 0,
      private_messages_deleted: 0,
    },
  });
});

test("buildDiscordServerByDayCsvRows keeps latest snapshot totals and day ledgers", () => {
  let history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  history = updateDiscordServerUserDays({
    history,
    memberJoinCounts: {
      "2026-04-10": 1,
      "2026-04-11": 2,
    },
    captureDate: "2026-04-14",
  });

  history = updateDiscordServerMessageDays({
    history,
    messageCreationCounts: {
      "2026-04-10": {
        total_messages: 5,
        public_total_messages: 4,
        private_total_messages: 1,
      },
      "2026-04-11": {
        total_messages: 2,
        public_total_messages: 1,
        private_total_messages: 1,
      },
    },
    captureDate: "2026-04-14",
  });

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-14T00:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-14T00:00:00.000Z",
      total_users: 3,
      online_users: 1,
      total_messages: 7,
      public_total_messages: 5,
      private_total_messages: 2,
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

  history = updateDiscordServerMessageDays({
    history,
    messageCreationCounts: {
      "2026-04-10": {
        total_messages: 4,
        public_total_messages: 3,
        private_total_messages: 1,
      },
      "2026-04-11": {
        total_messages: 3,
        public_total_messages: 2,
        private_total_messages: 1,
      },
      "2026-04-15": {
        total_messages: 6,
        public_total_messages: 5,
        private_total_messages: 1,
      },
    },
    captureDate: "2026-04-15",
  });

  history = upsertDiscordServerMetricsSnapshot({
    history,
    snapshotKey: "2026-04-15T00:00:00.000Z",
    snapshot: {
      captured_at: "2026-04-15T00:00:00.000Z",
      total_users: 3,
      online_users: 1,
      total_messages: 13,
      public_total_messages: 10,
      private_total_messages: 3,
    },
  });

  assert.deepEqual(buildDiscordServerByDayCsvRows(history), [
    {
      date: "2026-04-10",
      total_users: 1,
      users_joined: 1,
      users_left: 0,
      total_messages: 5,
      messages_created: 5,
      messages_deleted: 0,
      public_total_messages: 4,
      public_messages_created: 4,
      public_messages_deleted: 0,
      private_total_messages: 1,
      private_messages_created: 1,
      private_messages_deleted: 0,
    },
    {
      date: "2026-04-11",
      total_users: 3,
      users_joined: 2,
      users_left: 0,
      total_messages: 7,
      messages_created: 2,
      messages_deleted: 0,
      public_total_messages: 5,
      public_messages_created: 1,
      public_messages_deleted: 0,
      private_total_messages: 2,
      private_messages_created: 1,
      private_messages_deleted: 0,
    },
    {
      date: "2026-04-14",
      total_users: 3,
      users_joined: 0,
      users_left: 0,
      total_messages: 7,
      messages_created: 0,
      messages_deleted: 0,
      public_total_messages: 5,
      public_messages_created: 0,
      public_messages_deleted: 0,
      private_total_messages: 2,
      private_messages_created: 0,
      private_messages_deleted: 0,
    },
    {
      date: "2026-04-15",
      total_users: 3,
      users_joined: 2,
      users_left: 1,
      total_messages: 13,
      messages_created: 7,
      messages_deleted: 1,
      public_total_messages: 10,
      public_messages_created: 6,
      public_messages_deleted: 1,
      private_total_messages: 3,
      private_messages_created: 1,
      private_messages_deleted: 0,
    },
  ]);
});

test("buildDiscordUserMessageByDayCsvRows filters to top users within allowed dates", () => {
  let history = createEmptyDiscordServerMetricsHistory("123", "2026-04-14T00:00:00.000Z");

  history = replaceDiscordServerMessageUserCounts({
    history,
    messageUserCounts: {
      "2026-04-14": {
        user_a: { total_messages: 10, public_messages: 7, private_messages: 3 },
        user_b: { total_messages: 4, public_messages: 4, private_messages: 0 },
      },
      "2026-04-15": {
        user_a: { total_messages: 1, public_messages: 1, private_messages: 0 },
        user_c: { total_messages: 8, public_messages: 2, private_messages: 6 },
      },
    },
    messageUserLabels: {
      user_a: "Alice",
      user_b: "Bob",
      user_c: "Carol",
    },
  });

  assert.deepEqual(
    buildDiscordUserMessageByDayCsvRows(history, 2, new Set(["2026-04-14", "2026-04-15"])),
    [
      {
        date: "2026-04-14",
        user_id: "user_a",
        user_name: "Alice",
        total_messages: 10,
        public_messages: 7,
        private_messages: 3,
      },
      {
        date: "2026-04-15",
        user_id: "user_c",
        user_name: "Carol",
        total_messages: 8,
        public_messages: 2,
        private_messages: 6,
      },
      {
        date: "2026-04-15",
        user_id: "user_a",
        user_name: "Alice",
        total_messages: 1,
        public_messages: 1,
        private_messages: 0,
      },
    ],
  );
});
