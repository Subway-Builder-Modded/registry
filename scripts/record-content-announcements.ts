import { pathToFileURL } from "node:url";
import {
  loadContentAnnouncementLedger,
  recordContentAnnouncements,
  writeContentAnnouncementLedger,
} from "./lib/content-announcements.js";
import { loadCurrentIntegrityForPendingAnnouncement, loadPendingAnnouncementInputs, parsePendingAnnouncementFileArgs } from "./lib/pending-announcements.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

async function run(): Promise<void> {
  const files = parsePendingAnnouncementFileArgs(process.argv.slice(2));
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const ledger = loadContentAnnouncementLedger(repoRoot);
  let added = 0;

  const inputs = loadPendingAnnouncementInputs(
    repoRoot,
    files,
    (file) => console.log(`[content-announcements] Pending announcement file not found: ${file}`),
  );
  for (const input of inputs) {
    const pending = input.pending;
    const integrity = loadCurrentIntegrityForPendingAnnouncement(repoRoot, pending);
    added += recordContentAnnouncements({
      ledger,
      listingType: pending.listing_type,
      listingIds: pending.listings.map((entry) => entry.listing_id),
      integrity,
      recordedAt: pending.generated_at,
      source: `pending:${pending.listing_type}`,
    });
  }

  writeContentAnnouncementLedger(repoRoot, ledger);
  console.log(`[content-announcements] Recorded ${added} new entries`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runAndExitOnError(run);
}
