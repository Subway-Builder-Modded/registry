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
] as const;

import {
  LocationTagSchema,
  SourceQualitySchema,
  LevelOfDetailSchema,
  SpecialDemandTagSchema,
} from "@subway-builder-modded/registry-schemas";

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

// Maps ISO 3166-1 alpha-2 country codes to European sub-region location tags.
// CIA World Factbook definitions with user-specified adjustments:
//   Central  : DE AT CH LI SI + Visegrád (PL CZ SK HU)
//   Western  : FR Benelux + British Isles (GB IE) + Monaco
//   Southern : Iberia + Italian peninsula + Balkans
//   Northern : Scandinavia + Baltic states
//   Eastern  : Romania, Ukraine, Belarus, Moldova, Russia + Caucasus
export const COUNTRY_TO_EUROPE_SUB_REGION: Readonly<Record<string, string>> = {
  // Northern Europe — Scandinavia
  IS: "north-europe",
  NO: "north-europe",
  SE: "north-europe",
  DK: "north-europe",
  FI: "north-europe",
  // Northern Europe — Baltic states
  EE: "north-europe",
  LV: "north-europe",
  LT: "north-europe",

  // Western Europe — Atlantic seaboard + British Isles
  IE: "west-europe",
  GB: "west-europe",
  FR: "west-europe",
  NL: "west-europe",
  BE: "west-europe",
  LU: "west-europe",
  MC: "west-europe",

  // Central Europe — CIA Factbook definition + Visegrád
  DE: "central-europe",
  AT: "central-europe",
  CH: "central-europe",
  LI: "central-europe",
  SI: "central-europe",
  PL: "central-europe",
  CZ: "central-europe",
  SK: "central-europe",
  HU: "central-europe",

  // Southern Europe — Iberia, Italian peninsula, Balkans
  ES: "south-europe",
  PT: "south-europe",
  AD: "south-europe",
  IT: "south-europe",
  SM: "south-europe",
  VA: "south-europe",
  MT: "south-europe",
  GR: "south-europe",
  CY: "south-europe",
  HR: "south-europe",
  BA: "south-europe",
  RS: "south-europe",
  ME: "south-europe",
  MK: "south-europe",
  AL: "south-europe",
  XK: "south-europe",
  BG: "south-europe",
  GI: "south-europe",

  // Eastern Europe
  RO: "east-europe",
  MD: "east-europe",
  UA: "east-europe",
  BY: "east-europe",
  RU: "east-europe",
  AM: "east-europe",
  AZ: "east-europe",
  GE: "east-europe",
};

export function isOsmDataSource(value: string): boolean {
  return /osm/i.test(value);
}
