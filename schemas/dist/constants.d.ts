import { z } from "zod";
export declare const LocationTagSchema: z.ZodEnum<["caribbean", "central-america", "central-asia", "east-africa", "east-asia", "europe", "middle-east", "north-africa", "north-america", "oceania", "south-america", "south-asia", "southeast-asia", "southern-africa", "west-africa"]>;
export declare const SourceQualitySchema: z.ZodEnum<["low-quality", "medium-quality", "high-quality"]>;
export declare const LevelOfDetailSchema: z.ZodEnum<["low-detail", "medium-detail", "high-detail"]>;
export declare const SpecialDemandTagSchema: z.ZodEnum<["airports", "entertainment", "ferries", "hospitals", "parks", "schools", "universities"]>;
export type LocationTag = z.infer<typeof LocationTagSchema>;
export type SourceQuality = z.infer<typeof SourceQualitySchema>;
export type LevelOfDetail = z.infer<typeof LevelOfDetailSchema>;
export type SpecialDemandTag = z.infer<typeof SpecialDemandTagSchema>;
//# sourceMappingURL=constants.d.ts.map