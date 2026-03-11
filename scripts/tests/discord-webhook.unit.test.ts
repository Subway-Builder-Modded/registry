import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscordMarkdownMessage, buildDiscordWebhookPayload } from "../lib/discord-webhook.js";

test("buildDiscordMarkdownMessage renders markdown lines with run link", () => {
  const content = buildDiscordMarkdownMessage({
    webhookUrl: "https://discord.example/webhook",
    title: "Regenerate Download Counts",
    status: "success",
    lines: [
      "- **Updated records:** 10",
      "- **New downloads:** +25",
    ],
    runUrl: "https://github.com/example/repo/actions/runs/1",
  });

  assert.equal(
    content,
    [
      "**Regenerate Download Counts** (`success`)",
      "- **Updated records:** 10",
      "- **New downloads:** +25",
      "[View workflow run](https://github.com/example/repo/actions/runs/1)",
    ].join("\n"),
  );
});

test("buildDiscordWebhookPayload colors summary by status and warnings/errors by severity", () => {
  const payload = buildDiscordWebhookPayload({
    webhookUrl: "https://discord.example/webhook",
    title: "Regenerate Download Counts",
    status: "failure",
    lines: ["- **Updated records:** 0"],
    warnings: ["map: skipped version x"],
    errors: ["workflow failed"],
    runUrl: "https://github.com/example/repo/actions/runs/1",
  });

  assert.equal(payload.embeds.length, 3);
  assert.equal(payload.embeds[0]?.color, 0xE74C3C);
  assert.equal(payload.embeds[1]?.color, 0xF1C40F);
  assert.equal(payload.embeds[1]?.title, "Warnings (1)");
  assert.equal(payload.embeds[2]?.color, 0xE74C3C);
  assert.equal(payload.embeds[2]?.title, "Errors (1)");
});

