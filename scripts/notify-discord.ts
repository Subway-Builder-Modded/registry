import { pathToFileURL } from "node:url";
import { sendDiscordMarkdown } from "./lib/discord-webhook.js";

interface ParsedNotificationPayload {
  title: string;
  status: string;
  lines: string[];
  runUrl?: string;
  warnings: string[];
  errors: string[];
}

function parseLines(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => entry.trim());
  } catch {
    return [];
  }
}

function parseStringArray(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => entry.trim());
  } catch {
    return [];
  }
}

function readPayloadFromEnv(): ParsedNotificationPayload {
  const status = process.env.DISCORD_STATUS?.trim() || "unknown";
  const errors = parseStringArray(process.env.DISCORD_ERRORS_JSON);
  if (errors.length === 0 && status.toLowerCase() !== "success") {
    errors.push("Workflow finished with a non-success status. Check run logs.");
  }
  return {
    title: process.env.DISCORD_TITLE?.trim() || "Workflow Notification",
    status,
    runUrl: process.env.DISCORD_RUN_URL?.trim() || undefined,
    lines: parseLines(process.env.DISCORD_LINES_JSON),
    warnings: parseStringArray(process.env.DISCORD_WARNINGS_JSON),
    errors,
  };
}

async function run(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL not set; skipping Discord notification.");
    return;
  }

  const payload = readPayloadFromEnv();
  await sendDiscordMarkdown({
    webhookUrl,
    title: payload.title,
    status: payload.status,
    lines: payload.lines,
    runUrl: payload.runUrl,
    warnings: payload.warnings,
    errors: payload.errors,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

