import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeAnnouncement } from "./make-announcement.js";
import type { PendingAnnouncementsFile } from "./generate-downloads.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliArgs {
  files: string[];
}

function parseCliArgs(argv: string[]): CliArgs {
  const files: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--file") {
      const file = argv[index + 1];
      if (!file || file.startsWith("-")) {
        throw new Error(`Missing file value after '${arg}'`);
      }
      files.push(file.trim());
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument '${arg}'. Supported flags: --file <path>.`);
  }

  if (files.length === 0) {
    throw new Error("Missing pending announcement file path. Use --file <path>.");
  }

  return { files };
}

function readPendingAnnouncements(filePath: string): PendingAnnouncementsFile {
  return JSON.parse(readFileSync(filePath, "utf8")) as PendingAnnouncementsFile;
}

async function run(): Promise<void> {
  const { files } = parseCliArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  let sent = 0;

  for (const file of files) {
    const absoluteFilePath = resolve(repoRoot, file);
    if (!existsSync(absoluteFilePath)) {
      console.log(`[announcement] Pending announcement file not found: ${file}`);
      continue;
    }
    const pending = readPendingAnnouncements(absoluteFilePath);
    for (const entry of pending.listings) {
      await makeAnnouncement(resolve(repoRoot, entry.manifest_path));
      sent += 1;
      console.log(`[announcement] Sent: ${entry.listing_id}`);
    }
  }

  console.log(`[announcement] Completed: sent=${sent}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runAndExitOnError(run);
}
