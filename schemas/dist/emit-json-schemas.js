import { writeFileSync, mkdirSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ListingManifestSchema, ModManifestSchema, MapManifestSchema, GridStatisticsSchema, DownloadAttributionLedgerSchema, DownloadAttributionDeltaSchema, DownloadVersionBucketLedgerSchema, IntegrityOutputSchema, IntegrityCacheSchema, DownloadHistorySnapshotSchema, DownloadAttributionHistorySnapshotSchema, SecurityRulesFileSchema, } from "./index.js";
const SCHEMAS = {
    "manifest": ListingManifestSchema,
    "mod-manifest": ModManifestSchema,
    "map-manifest": MapManifestSchema,
    "grid-statistics": GridStatisticsSchema,
    "attribution-ledger": DownloadAttributionLedgerSchema,
    "attribution-delta": DownloadAttributionDeltaSchema,
    "version-bucket-ledger": DownloadVersionBucketLedgerSchema,
    "integrity-output": IntegrityOutputSchema,
    "integrity-cache": IntegrityCacheSchema,
    "download-history-snapshot": DownloadHistorySnapshotSchema,
    "attribution-history-snapshot": DownloadAttributionHistorySnapshotSchema,
    "security-rules": SecurityRulesFileSchema,
};
mkdirSync("json-schemas", { recursive: true });
const index = {};
for (const [name, schema] of Object.entries(SCHEMAS)) {
    const jsonSchema = zodToJsonSchema(schema, { name, $refStrategy: "none" });
    const path = `json-schemas/${name}.schema.json`;
    writeFileSync(path, JSON.stringify(jsonSchema, null, 2) + "\n");
    index[name] = jsonSchema;
    console.log(`Emitted ${path}`);
}
writeFileSync("json-schemas/index.json", JSON.stringify(index, null, 2) + "\n");
console.log("Emitted json-schemas/index.json");
