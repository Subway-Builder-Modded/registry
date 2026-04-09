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
