import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { freezeListingDownloads } from "../lib/grandfathered-downloads.js";
import { resolveListingById } from "../lib/manifests.js";
import { getOptionalIssueValue } from "../lib/map-field-utils.js";
import { assertValidRegistryManifest } from "../lib/registry-manifest.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

function main() {
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorId = process.env.ISSUE_AUTHOR_ID;

  if (!issueJson || !issueAuthorId) {
    console.error("ISSUE_JSON and ISSUE_AUTHOR_ID environment variables are required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson) as Record<string, unknown>;
  const rawId = data["asset-id"];
  const id = typeof rawId === "string" ? rawId.trim() : "";

  const resolved = resolveListingById(REPO_ROOT, id);
  if (!resolved) {
    throw new Error(`No mod or map with ID "${id}" exists in the registry`);
  }
  if (resolved.manifest.deprecation !== undefined) {
    throw new Error(`The ${resolved.type} "${id}" is already deprecated`);
  }

  const reason = getOptionalIssueValue(data.reason);
  resolved.manifest.deprecation = {
    since: new Date().toISOString(),
    by_github_id: Number(issueAuthorId),
    ...(reason ? { reason } : {}),
  };

  assertValidRegistryManifest(
    resolved.manifest,
    `Deprecated ${resolved.dir}/${id}/manifest.json`,
  );

  writeFileSync(resolved.manifestPath, JSON.stringify(resolved.manifest, null, 2) + "\n");
  console.log(`Deprecated ${resolved.dir}/${id}/manifest.json`);

  // Freeze last-known download counts so they survive the deprecation
  // overlay, which removes the listing from pipeline output every run.
  const frozen = freezeListingDownloads(REPO_ROOT, resolved.type, id);
  if (frozen) {
    const total = Object.values(frozen).reduce((sum, n) => sum + n, 0);
    console.log(
      `Froze ${total} downloads across ${Object.keys(frozen).length} version(s) into ${resolved.dir}/grandfathered-downloads.json`,
    );
  } else {
    console.log(`No download counts to freeze for ${id}`);
  }
}

main();
