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
  const existing = resolved.manifest.deprecation as
    | { since: string; by_github_id: number; reason?: string; deleted?: true }
    | undefined;
  if (existing?.deleted === true) {
    throw new Error(`The ${resolved.type} "${id}" is already deleted`);
  }

  // Escalation keeps the original `since`; the deleter takes over
  // `by_github_id`, and `reason` is replaced only when newly provided.
  const reason = getOptionalIssueValue(data.reason);
  resolved.manifest.deprecation = {
    since: existing?.since ?? new Date().toISOString(),
    by_github_id: Number(issueAuthorId),
    ...(reason ? { reason } : existing?.reason ? { reason: existing.reason } : {}),
    deleted: true,
  };

  assertValidRegistryManifest(
    resolved.manifest,
    `Deleted ${resolved.dir}/${id}/manifest.json`,
  );

  writeFileSync(resolved.manifestPath, JSON.stringify(resolved.manifest, null, 2) + "\n");
  console.log(`Deleted ${resolved.dir}/${id}/manifest.json${existing ? " (escalated from deprecation)" : ""}`);

  // Freeze last-known download counts so they survive the pipeline overlay.
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
