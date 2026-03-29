import type * as D from "../download-definitions.js";
import type { IntegrityVersionEntry } from "../integrity.js";
import { warnListing } from "../downloads-support.js";

interface ApplyDownloadCountParams {
  warnings: string[];
  listingId: string;
  version: string;
  result: IntegrityVersionEntry | undefined;
  downloadCount: number | undefined;
  downloadsByListing: D.DownloadsByListing;
}

export function applyDownloadCountForVersion(params: ApplyDownloadCountParams): boolean {
  const {
    warnings,
    listingId,
    version,
    result,
    downloadCount,
    downloadsByListing,
  } = params;

  if (result?.is_complete === true && typeof downloadCount === "number") {
    downloadsByListing[listingId][version] = downloadCount;
    return true;
  }

  warnListing(
    warnings,
    listingId,
    `excluded by integrity validation (${result?.errors.join("; ") || "unknown error"})`,
    version,
  );
  return false;
}

