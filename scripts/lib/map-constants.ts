// Union of city codes the base game has shipped across versions, plus codes
// reserved by incident history. A code stays here even if a later game version
// renames it: an older install still owns the old code. The CURRENT game list is
// synced automatically into maps/vanilla-city-codes.json (sync-vanilla-city-codes,
// 4-hourly) and unioned with this floor via loadVanillaCityCodeSet — see
// KNOWN_INCIDENTS.md 2026-08 French-city entry for what a stale list costs.
export const VANILLA_CITY_CODES = [
  "NYC",
  "DAL",
  "CHI",
  "SFO",
  "WAS",
  "PHX",
  "HOU",
  "ATL",
  "MIA",
  "SEA",
  "PHL",
  "DEN",
  "DET",
  "SAN",
  "MSP",
  "BOS",
  "AUS",
  "PDX",
  "STL",
  "SLC",
  "IND",
  "CMH",
  "CLE",
  "CIN",
  "MKE",
  "BAL",
  "PIT",
  "CLT",
  "HNL",
  "LON",
  "BHM",
  "MAN",
  "LIV",
  "NCL",
  // Codes observed in shipped latest-cities.yml files but missing above
  // (game code spellings that diverged from this list's originals).
  "SF",
  "DC",
  "LA",
  "BIR",
  "COL",
  "NEW",
  // Cities added by the 2026-08 base-game update, per the live
  // ctiles.subwaybuilder.com/cities/latest-cities.yml. The French codes collided
  // with pierreggt's modded listings (PAR directly; and marseille's rename landed
  // ON the vanilla MAR — see KNOWN_INCIDENTS.md).
  "PAR",
  "LYO",
  "MAR",
  "NO",
  "RAL",
  "SAC",
  "KC",
  "NAS",
  "DUB",
] as const;

// Reserved (never vanilla): codes held back during a city-code migration because
// stale installs on user disks still hold files under them — a NEW listing
// claiming one would extract into those folders. Distinct from vanilla codes so
// validation can explain the rejection honestly. Empty when no migration is in
// flight; add codes here at the start of a migration and release them when the
// corresponding incident closes.
// History: LYS + MRS were reserved during the 2026-08 French city-code
// migration (KNOWN_INCIDENTS.md). MRS was released 2026-08-20 back to
// marseille (original holder reclaiming its own code, issue #8327); LYS was
// released 2026-08-26 when the incident closed (lyon settled on LSY).
export const RESERVED_CITY_CODES: readonly string[] = [];

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LocationTagSchema,
  SourceQualitySchema,
  LevelOfDetailSchema,
  SpecialDemandTagSchema,
} from "@subway-builder-modded/registry-schemas";

// Canonical ISO country → location tag mapping; `location` is derived from
// `country` at intake and never user-selected.
export { COUNTRY_TO_LOCATION } from "@subway-builder-modded/registry-schemas";

export const LOCATION_TAGS = LocationTagSchema.options;
export const SPECIAL_DEMAND_TAGS = SpecialDemandTagSchema.options;
export const SOURCE_QUALITY_VALUES = SourceQualitySchema.options;
export const LEVEL_OF_DETAIL_VALUES = LevelOfDetailSchema.options;

export const DEFAULT_MAP_DATA_SOURCE = "OSM" as const;
export const DEFAULT_SOURCE_QUALITY = "low-quality" as const;
export const DEFAULT_LEVEL_OF_DETAIL = "low-detail" as const;
export const MAX_OSM_SOURCE_QUALITY = "medium-quality" as const;

export const VANILLA_CITY_CODE_SET = new Set<string>(VANILLA_CITY_CODES);

// loadVanillaCityCodeSet unions the hardcoded historical floor above with the
// auto-synced current game list (maps/vanilla-city-codes.json, written by
// sync-vanilla-city-codes in the 4-hourly analytics workflow). Validators should
// prefer this over VANILLA_CITY_CODE_SET so newly shipped vanilla cities reject
// colliding listings without a manual constants update. A missing or malformed
// synced file degrades to the hardcoded floor.
export function loadVanillaCityCodeSet(repoRoot: string): Set<string> {
  const codes = new Set<string>(VANILLA_CITY_CODES);
  try {
    const raw = JSON.parse(
      readFileSync(resolve(repoRoot, "maps", "vanilla-city-codes.json"), "utf-8"),
    ) as { codes?: unknown };
    if (Array.isArray(raw.codes)) {
      for (const code of raw.codes) {
        if (typeof code === "string" && code.trim() !== "") {
          codes.add(code.trim());
        }
      }
    }
  } catch {
    // Synced file absent or unreadable — the hardcoded floor still applies.
  }
  return codes;
}
export const LOCATION_TAG_SET = new Set<string>(LOCATION_TAGS);
export const SPECIAL_DEMAND_TAG_SET = new Set<string>(SPECIAL_DEMAND_TAGS);
export const SOURCE_QUALITY_SET = new Set<string>(SOURCE_QUALITY_VALUES);
export const LEVEL_OF_DETAIL_SET = new Set<string>(LEVEL_OF_DETAIL_VALUES);

export const GRANDFATHERED_CITY_CODE_DUPLICATES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["DAY", new Set(["dayton-oh", "daytonatti"])],
]);

export function isOsmDataSource(value: string): boolean {
  return /osm/i.test(value);
}
