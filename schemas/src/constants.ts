import { z } from "zod";

export const LocationTagSchema = z.enum([
  "caribbean",
  "central-america",
  "central-asia",
  "east-africa",
  "east-asia",
  "europe",
  "middle-east",
  "north-africa",
  "north-america",
  "oceania",
  "south-america",
  "south-asia",
  "southeast-asia",
  "southern-africa",
  "west-africa",
]);

export const SourceQualitySchema = z.enum([
  "low-quality",
  "medium-quality",
  "high-quality",
]);

export const LevelOfDetailSchema = z.enum([
  "low-detail",
  "medium-detail",
  "high-detail",
]);

export const SpecialDemandTagSchema = z.enum([
  "airports",
  "entertainment",
  "ferries",
  "hospitals",
  "parks",
  "schools",
  "universities",
]);

export type LocationTag = z.infer<typeof LocationTagSchema>;
export type SourceQuality = z.infer<typeof SourceQualitySchema>;
export type LevelOfDetail = z.infer<typeof LevelOfDetailSchema>;
export type SpecialDemandTag = z.infer<typeof SpecialDemandTagSchema>;
