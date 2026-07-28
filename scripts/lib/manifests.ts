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
