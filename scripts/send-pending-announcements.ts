import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeAnnouncement } from "./make-announcement.js";
import {
  loadPendingAnnouncementInputs,
  parsePendingAnnouncementFileArgs,
} from "./lib/pending-announcements.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

async function run(): Promise<void> {
  const files = parsePendingAnnouncementFileArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  let sent = 0;

  const inputs = loadPendingAnnouncementInputs(
    repoRoot,
    files,
    (file) => console.log(`[announcement] Pending announcement file not found: ${file}`),
  );
  for (const input of inputs) {
    const pending = input.pending;
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
