import { join } from "node:path";
import { isObject, readJsonFile } from "../json-utils.js";
import { isTestListing } from "../test-listings.js";
import { resolveAuthorPresentation, type AuthorAliasIndex } from "../author-aliases.js";
import type { ListingKey, ListingMeta, ListingProjectRow, ListingTotals } from "./types.js";

export function toListingLabel(listingType: "maps" | "mods"): "map" | "mod" {
  return listingType === "maps" ? "map" : "mod";
}

export function filterOutTestListingTotals(
  repoRoot: string,
  totals: ListingTotals,
): ListingTotals {
  const filtered = new Map<ListingKey, number>();
  for (const [key, total] of totals.entries()) {
    const [listingType, id] = key.split(":") as ["maps" | "mods", string];
    if (isTestListing(repoRoot, listingType, id)) continue;
    filtered.set(key, total);
  }
  return filtered;
}

export function loadManifestMeta(
  repoRoot: string,
  listingType: "maps" | "mods",
  id: string,
  authorAliases: AuthorAliasIndex,
): ListingMeta {
  const manifestPath = join(repoRoot, listingType, id, "manifest.json");
  try {
    const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
    const name = typeof manifest.name === "string" && manifest.name.trim() !== ""
      ? manifest.name
      : id;
    const author = typeof manifest.author === "string" && manifest.author.trim() !== ""
      ? manifest.author
      : "UNKNOWN";
    const githubId = typeof manifest.github_id === "number" && Number.isFinite(manifest.github_id)
      ? manifest.github_id
      : null;
    const presentation = resolveAuthorPresentation(author, githubId, authorAliases);
    return {
      name,
      author: presentation.author,
      author_alias: presentation.author_alias,
      attribution_link: presentation.attribution_link,
      github_id: githubId,
    };
  } catch {
    return {
      name: id,
      author: "UNKNOWN",
      author_alias: "UNKNOWN",
      attribution_link: "https://github.com/UNKNOWN",
      github_id: null,
    };
  }
}

export function parseProjectFromUrl(urlValue: string): { projectKey: string; projectName: string } | null {
  try {
    const parsed = new URL(urlValue);
    const segments = parsed.pathname.split("/").filter((segment) => segment !== "");

    if (parsed.hostname === "github.com" && segments.length >= 2) {
      const owner = segments[0]!;
      const repo = segments[1]!;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }

    if (parsed.hostname === "raw.githubusercontent.com" && segments.length >= 2) {
      const owner = segments[0]!;
      const repo = segments[1]!;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }

    if (parsed.hostname.endsWith(".github.io")) {
      const owner = parsed.hostname.slice(0, -".github.io".length);
      const repo = segments[0] ?? owner;
      return {
        projectKey: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
        projectName: repo,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function loadListingProjectRow(
  repoRoot: string,
  listingType: "maps" | "mods",
  id: string,
): ListingProjectRow {
  const manifestPath = join(repoRoot, listingType, id, "manifest.json");
  const listingLabel = toListingLabel(listingType);

  try {
    const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
    const name = typeof manifest.name === "string" && manifest.name.trim() !== ""
      ? manifest.name
      : id;

    const sourceUrl = typeof manifest.source === "string" ? manifest.source.trim() : "";
    const update = isObject(manifest.update) ? manifest.update : null;
    const updateRepo = typeof update?.repo === "string" ? update.repo.trim() : "";
    const updateUrl = typeof update?.url === "string" ? update.url.trim() : "";

    const parsedProject = (
      (sourceUrl !== "" ? parseProjectFromUrl(sourceUrl) : null)
      ?? (updateUrl !== "" ? parseProjectFromUrl(updateUrl) : null)
      ?? (updateRepo !== ""
        ? {
          projectKey: updateRepo.toLowerCase(),
          projectName: updateRepo.split("/").pop() ?? updateRepo,
        }
        : null)
    );

    return {
      listing_type: listingLabel,
      id,
      name,
      project_key: parsedProject?.projectKey ?? `${listingLabel}:${id}`,
      project_name: parsedProject?.projectName ?? name,
    };
  } catch {
    return {
      listing_type: listingLabel,
      id,
      name: id,
      project_key: `${listingLabel}:${id}`,
      project_name: id,
    };
  }
}
