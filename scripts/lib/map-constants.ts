// Union of city codes the base game has shipped across versions. A code stays here
// even if a later game version renames it: an older install still owns the old code.
// When the game adds cities, add their codes here (source: the game's
// cities/latest-cities.yml) — see KNOWN_INCIDENTS.md 2026-08 French-city entry for
// what a missed addition costs.
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
  // French cities added by the 2026-08 base-game update. Their codes collided with
  // pierreggt's modded Lyon/Marseille/Paris listings, which re-released under
  // LSY/MAR/PRS (see KNOWN_INCIDENTS.md).
  "LYS",
  "MRS",
  "PAR",
] as const;

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
