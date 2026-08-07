import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveCaretaker, type ManifestWithCaretakers } from "../lib/caretakers.js";
import { resolveListingById } from "../lib/manifests.js";

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
  const errors: string[] = [];

  // The permanence acknowledgement is the form's required checkbox; verify it
  // server-side too so a hand-edited issue body cannot skip it.
  const confirmation = data["confirmation"];
  const acknowledged = typeof confirmation === "string" && confirmation.trim().length > 0
    && !/^_?no response_?$/i.test(confirmation.trim());
  if (!acknowledged) {
    errors.push("**Confirmation**: You must acknowledge that deletion is permanent.");
  }

  if (!id) {
    errors.push("**asset-id**: Must provide an asset ID.");
  } else {
    const resolved = resolveListingById(REPO_ROOT, id);
    if (!resolved) {
      errors.push(`**asset-id**: No mod or map with ID \`${id}\` exists in the registry.`);
    } else {
      const manifest = resolved.manifest;

      // Escalating a deprecated asset to deleted is allowed; re-deleting is not.
      if (manifest.deprecation !== undefined
        && (manifest.deprecation as Record<string, unknown>).deleted === true) {
        errors.push(`**asset-id**: The ${resolved.type} \`${id}\` is already deleted.`);
      }

      if (manifest.is_test === true) {
        errors.push(
          `**asset-id**: \`${id}\` is a test listing. Test listings are removed outright rather `
          + `than deleted — please contact a maintainer.`,
        );
      }

      // Same authorization rule as deprecation: only the original publisher
      // or the ACTIVE caretaker, never ordinary collaborators.
      const requesterId = String(issueAuthorId);
      const ownerId = String(manifest.github_id);
      const activeCaretaker = getActiveCaretaker(manifest as unknown as ManifestWithCaretakers);
      const caretakerId = activeCaretaker ? String(activeCaretaker.github_id) : null;

      if (requesterId !== ownerId && requesterId !== caretakerId) {
        errors.push(
          `**Ownership check failed**: Only the original publisher or the active caretaker of `
          + `\`${id}\` can delete it. Collaborators cannot delete a listing.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    const errorMessage = [
      "Deletion validation failed:\n",
      ...errors.map((e) => `- ${e}`),
      "\nIf you believe this is an error, please contact a maintainer.",
    ].join("\n");

    writeFileSync(resolve(REPO_ROOT, "scripts", "validation-error.md"), errorMessage);
    console.error(errorMessage);
    process.exit(1);
  }

  console.log("Deletion validation passed.");
}

main();
