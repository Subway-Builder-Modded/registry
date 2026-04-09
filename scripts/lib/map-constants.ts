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

export function isOsmDataSource(value: string): boolean {
  return /osm/i.test(value);
}
