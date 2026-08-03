import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonFile } from "./json-utils.js";

export type ManifestType = "map" | "mod";
export type ManifestDirectory = "maps" | "mods";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type {
  UpdateConfig as UpdateType,
  InitialViewState,
  ModManifest,
  MapManifest,
  ListingManifest,
  GridStatistics,
} from "@subway-builder-modded/registry-schemas";

export function resolveManifestType(value: string | undefined): ManifestType {
  return value === "map" ? "map" : "mod";
}

export function resolveListingIdAndDir(
  kind: ManifestType,
  data: Record<string, unknown>,
): { id: string; dir: ManifestDirectory } {
  if (kind === "map") {
    return { id: String(data["map-id"]), dir: "maps" };
  }
  return { id: String(data["mod-id"]), dir: "mods" };
}

export interface ResolvedListing {
  type: ManifestType;
  dir: ManifestDirectory;
  manifestPath: string;
  manifest: JsonObject;
}

/**
 * Resolve a bare listing ID to its collection by probing both directories.
 * Listing IDs are unique across maps and mods (enforced at publish time by
 * checkCrossTypeIdUniqueness and continuously by check-id-uniqueness), so a
 * bare ID identifies at most one listing. Returns null when no listing with
 * that ID exists; throws if the uniqueness invariant is somehow violated.
 */
export function resolveListingById(repoRoot: string, id: string): ResolvedListing | null {
  const matches: ResolvedListing[] = [];
  for (const [type, dir] of [["map", "maps"], ["mod", "mods"]] as const) {
    const manifestPath = resolve(repoRoot, dir, id, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    matches.push({ type, dir, manifestPath, manifest: readJsonFile<JsonObject>(manifestPath) });
  }
  if (matches.length > 1) {
    throw new Error(
      `Listing ID "${id}" exists in both maps/ and mods/ — cross-collection uniqueness is violated`,
    );
  }
  return matches[0] ?? null;
}

/** Listing ids from <dir>/index.json (its "maps"/"mods" array), in index order. */
export function readListingIdsFromIndex(repoRoot: string, dir: ManifestDirectory): string[] {
  const indexPath = resolve(repoRoot, dir, "index.json");
  const parsed = readJsonFile<Record<string, unknown>>(indexPath);
  const ids = parsed[dir];
  if (!Array.isArray(ids)) {
    throw new Error(`Invalid ${dir}/index.json at ${indexPath}: missing ${dir} array`);
  }
  return ids.filter((value): value is string => typeof value === "string");
}
