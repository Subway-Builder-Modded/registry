import { z } from "zod";
export declare const LocationTagSchema: z.ZodEnum<["caribbean", "central-america", "central-asia", "central-europe", "east-africa", "east-asia", "east-europe", "europe", "middle-east", "north-africa", "north-america", "north-europe", "oceania", "south-america", "south-asia", "south-europe", "southeast-asia", "southern-africa", "west-africa", "west-europe"]>;
export declare const SourceQualitySchema: z.ZodEnum<["low-quality", "medium-quality", "high-quality"]>;
export declare const LevelOfDetailSchema: z.ZodEnum<["low-detail", "medium-detail", "high-detail"]>;
export declare const SpecialDemandTagSchema: z.ZodEnum<["airports", "entertainment", "ferries", "hospitals", "parks", "schools", "universities"]>;
export type LocationTag = z.infer<typeof LocationTagSchema>;
export type SourceQuality = z.infer<typeof SourceQualitySchema>;
export type LevelOfDetail = z.infer<typeof LevelOfDetailSchema>;
export type SpecialDemandTag = z.infer<typeof SpecialDemandTagSchema>;
//# sourceMappingURL=constants.d.ts.map