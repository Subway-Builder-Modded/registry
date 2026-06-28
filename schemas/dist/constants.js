import { z } from "zod";
export const LocationTagSchema = z.enum([
    "caribbean",
    "central-america",
    "central-asia",
    "central-europe",
    "east-africa",
    "east-asia",
    "east-europe",
    // "europe" kept during transition so existing manifests remain valid until
    // sub_location migration is complete and location fields are updated.
    "europe",
    "middle-east",
    "north-africa",
    "north-america",
    "north-europe",
    "oceania",
    "south-america",
    "south-asia",
    "south-europe",
    "southeast-asia",
    "southern-africa",
    "west-africa",
    "west-europe",
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
