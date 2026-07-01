import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeAnnouncement } from "./make-announcement.js";
import {
  hasContentAnnouncementRecord,
  loadContentAnnouncementLedger,
} from "./lib/content-announcements.js";
import {
  loadPendingAnnouncementInputs,
  parsePendingAnnouncementFileArgs,
} from "./lib/pending-announcements.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

async function run(): Promise<void> {
  const files = parsePendingAnnouncementFileArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  // Load the ledger at send time (commit job checks out latest main, so this
  // reflects any announcements already sent by a concurrent or preceding run).
  const ledger = loadContentAnnouncementLedger(repoRoot);
  let sent = 0;
  let skipped = 0;

  const inputs = loadPendingAnnouncementInputs(
    repoRoot,
    files,
    (file) => console.log(`[announcement] Pending announcement file not found: ${file}`),
  );
  for (const input of inputs) {
    const pending = input.pending;
    for (const entry of pending.listings) {
      if (hasContentAnnouncementRecord(ledger, pending.listing_type, entry.listing_id)) {
        console.log(`[announcement] Already announced, skipping: ${entry.listing_id}`);
        skipped += 1;
        continue;
      }
      await makeAnnouncement(resolve(repoRoot, entry.manifest_path));
      sent += 1;
      console.log(`[announcement] Sent: ${entry.listing_id}`);
    }
  }

  console.log(`[announcement] Completed: sent=${sent} skipped=${skipped}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runAndExitOnError(run);
}
