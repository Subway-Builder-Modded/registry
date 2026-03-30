import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ListingDirectory = "maps" | "mods";

function readManifest(repoRoot: string, listingType: ListingDirectory, id: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot, listingType, id, "manifest.json"), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTestListing(repoRoot: string, listingType: ListingDirectory, id: string): boolean {
  const manifest = readManifest(repoRoot, listingType, id);
  return manifest?.is_test === true;
}

function extractListingId(message: string): string | null {
  const quoted = message.match(/\blisting='([^']+)'/);
  if (quoted?.[1]) return quoted[1];

  const plain = message.match(/\blisting=([^ :]+)(?:\s|:|$)/);
  if (plain?.[1]) return plain[1];

  return null;
}

export function filterListingMessages(
  messages: string[],
  isTestId: (listingId: string) => boolean,
): string[] {
  return messages.filter((message) => {
    const listingId = extractListingId(message);
    if (!listingId) return true;
    return !isTestId(listingId);
  });
}
