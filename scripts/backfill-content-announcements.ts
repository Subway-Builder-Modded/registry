import { pathToFileURL } from "node:url";
import {
  createEmptyContentAnnouncementLedger,
  recordContentAnnouncements,
  writeContentAnnouncementLedger,
} from "./lib/content-announcements.js";
import { getDirectoryForType, loadIntegritySnapshot } from "./lib/downloads-support.js";
import type { ManifestType } from "./lib/manifests.js";
import { resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

function backfillForType(
  repoRoot: string,
  ledger: ReturnType<typeof createEmptyContentAnnouncementLedger>,
  listingType: ManifestType,
): number {
  const integrity = loadIntegritySnapshot(repoRoot, getDirectoryForType(listingType));
  if (!integrity) {
    return 0;
  }
  const listingIds = Object.entries(integrity.listings)
    .filter(([, listing]) => listing.has_complete_version)
    .map(([listingId]) => listingId);
  return recordContentAnnouncements({
    ledger,
    listingType,
    listingIds,
    integrity,
    recordedAt: integrity.generated_at,
    source: "bootstrap:complete-integrity-snapshot",
  });
}

async function run(): Promise<void> {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const ledger = createEmptyContentAnnouncementLedger();
  const mapsAdded = backfillForType(repoRoot, ledger, "map");
  const modsAdded = backfillForType(repoRoot, ledger, "mod");
  writeContentAnnouncementLedger(repoRoot, ledger);
  console.log(`[content-announcements] Backfilled entries: maps=${mapsAdded}, mods=${modsAdded}, total=${mapsAdded + modsAdded}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runAndExitOnError(run);
}
