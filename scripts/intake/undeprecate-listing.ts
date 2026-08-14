import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Deprecation, DeprecationHistoryEntry } from "@subway-builder-modded/registry-schemas";
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

  if (!process.env.ISSUE_AUTHOR_ID) {
    console.error("ISSUE_AUTHOR_ID environment variable is required");
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
  // Close the window into deprecation_history first, so the reversal does not
  // also erase the fact that it happened.
  const { deleted: _deleted, ...closed } = resolved.manifest.deprecation as Deprecation;
  const history = (resolved.manifest.deprecation_history ?? []) as DeprecationHistoryEntry[];
  resolved.manifest.deprecation_history = [
    ...history,
    {
      ...closed,
      until: new Date().toISOString(),
      removed_by_github_id: Number(process.env.ISSUE_AUTHOR_ID),
    },
  ];
  delete resolved.manifest.deprecation;

  assertValidRegistryManifest(
    resolved.manifest,
    `Un-deprecated ${resolved.dir}/${id}/manifest.json`,
  );

  writeFileSync(resolved.manifestPath, JSON.stringify(resolved.manifest, null, 2) + "\n");
  console.log(`Un-deprecated ${resolved.dir}/${id}/manifest.json`);
}

main();
