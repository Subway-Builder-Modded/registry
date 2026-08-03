import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveListingById } from "../lib/manifests.js";
import { assertValidRegistryManifest } from "../lib/registry-manifest.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

function main() {
  const issueJson = process.env.ISSUE_JSON;

  if (!issueJson) {
    console.error("ISSUE_JSON environment variable is required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson) as Record<string, unknown>;
  const rawId = data["asset-id"];
  const id = typeof rawId === "string" ? rawId.trim() : "";

  const resolved = resolveListingById(REPO_ROOT, id);
  if (!resolved) {
    throw new Error(`No mod or map with ID "${id}" exists in the registry`);
  }
  if (resolved.manifest.deprecation === undefined) {
    throw new Error(`The ${resolved.type} "${id}" is not deprecated`);
  }

  // Removing the field is the complete reversal: the published integrity view,
  // search visibility, and downloadability all derive from it and self-heal on
  // the next pipeline run (the integrity cache kept the true state throughout).
  delete resolved.manifest.deprecation;

  assertValidRegistryManifest(
    resolved.manifest,
    `Un-deprecated ${resolved.dir}/${id}/manifest.json`,
  );

  writeFileSync(resolved.manifestPath, JSON.stringify(resolved.manifest, null, 2) + "\n");
  console.log(`Un-deprecated ${resolved.dir}/${id}/manifest.json`);
}

main();
