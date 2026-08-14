import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCustomUpdateUrl } from "../lib/custom-url.js";
import { validateGitHubRepo } from "../lib/github.js";
import {
  type ManifestType,
  type MapManifest,
  type ModManifest,
  resolveListingIdAndDir,
  resolveManifestType as resolveManifestType,
} from "../lib/manifests.js";
import { resolveCollaboratorUpdate } from "../lib/collaborators.js";
import { getActiveCaretaker, resolveCaretakerUpdate } from "../lib/caretakers.js";
import { isMaintainer } from "../lib/maintainers.js";
import { loadVanillaCityCodeSet } from "../lib/map-constants.js";
import { isPresentIssueValue } from "../lib/map-field-utils.js";
import { validateMapUpdateFields } from "../lib/map-update-logic.js";
import { checkCityCodeUniqueness } from "../lib/registry-uniqueness.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

// Fields that decide who controls a listing, or where its artifacts are served
// from. Editing any of them carries the same authorization as retiring the
// listing; everything else on the update forms is presentation metadata.
const PRIVILEGED_UPDATE_FIELDS = [
  "update-type",
  "github-repo",
  "custom-update-url",
  "collaborators",
  "caretaker",
] as const;

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveSourceUrl(
  data: Record<string, unknown>,
  existingManifest: ModManifest | MapManifest | null,
): string | undefined {
  if (isPresentIssueValue(data.source)) return data.source;
  if (existingManifest && isPresentIssueValue(existingManifest.source)) return existingManifest.source;
  return undefined;
}

async function validateGitHubUpdate(
  updateType: string | undefined,
  githubRepo: string | undefined,
  sourceUrl: string | undefined,
  manifestType: ManifestType,
  errors: string[],
): Promise<void> {
  if (updateType === "GitHub Releases" && isPresentIssueValue(githubRepo)) {
    if (!/^[^/]+\/[^/]+$/.test(githubRepo)) {
      errors.push("**github-repo**: Must provide a valid `owner/repo` when using GitHub Releases.");
      return;
    }
    const ghErrors = await validateGitHubRepo(githubRepo, sourceUrl, manifestType);
    errors.push(...ghErrors);
    return;
  }

  if (!updateType && isPresentIssueValue(githubRepo)) {
    if (!/^[^/]+\/[^/]+$/.test(githubRepo)) {
      errors.push("**github-repo**: Must provide a valid `owner/repo` when using GitHub Releases.");
      return;
    }
    const ghErrors = await validateGitHubRepo(githubRepo, sourceUrl, manifestType);
    errors.push(...ghErrors);
  }
}

async function validateCustomUrlUpdate(
  updateType: string | undefined,
  customUpdateUrl: string | undefined,
  manifestType: ManifestType,
  errors: string[],
): Promise<void> {
  if (updateType === "Custom URL" && isPresentIssueValue(customUpdateUrl)) {
    try {
      new URL(customUpdateUrl);
      const urlErrors = await validateCustomUpdateUrl(customUpdateUrl, manifestType);
      errors.push(...urlErrors);
    } catch {
      errors.push("**custom-update-url**: Must be a valid URL.");
    }
    return;
  }

  if (!updateType && isPresentIssueValue(customUpdateUrl)) {
    try {
      new URL(customUpdateUrl);
      const urlErrors = await validateCustomUpdateUrl(customUpdateUrl, manifestType);
      errors.push(...urlErrors);
    } catch {
      errors.push("**custom-update-url**: Must be a valid URL.");
    }
  }
}

async function main() {
  const manifestType = resolveManifestType(process.env.LISTING_TYPE);
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorId = process.env.ISSUE_AUTHOR_ID;

  if (!issueJson || !issueAuthorId) {
    console.error("ISSUE_JSON and ISSUE_AUTHOR_ID environment variables are required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson) as Record<string, unknown>;
  const { id, dir } = resolveListingIdAndDir(manifestType, data);
  const errors: string[] = [];
  let existingManifest: ModManifest | MapManifest | null = null;

  if (!id || typeof id !== "string") {
    errors.push(`**${manifestType}-id**: Must provide a valid ${manifestType} ID.`);
  } else {
    const manifestPath = resolve(REPO_ROOT, dir, id, "manifest.json");

    if (!existsSync(manifestPath)) {
      errors.push(`**${manifestType}-id**: No ${manifestType} with ID \`${id}\` exists in the registry.`);
    } else {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as
        | ModManifest
        | MapManifest;
      existingManifest = manifest;
      const ownerId = String(manifest.github_id);
      const authorId = String(issueAuthorId);
      const collaboratorIds = Array.isArray(manifest.collaborators)
        ? manifest.collaborators.map((id) => String(id))
        : [];

      // Deletion is permanent: the listing survives only as a record, so its
      // metadata stops being the author's to edit. Plain deprecation is
      // reversible, and tidying a listing before restoring it is legitimate.
      if ((manifest.deprecation as { deleted?: boolean } | undefined)?.deleted === true
        && !isMaintainer(authorId)) {
        errors.push(
          `**${manifestType}-id**: \`${id}\` was permanently deleted and its metadata can no `
          + `longer be changed. Returning the content to the registry requires publishing a new `
          + `listing; contact a maintainer if the record itself is wrong.`,
        );
      }

      // Code owners may act on any listing (see lib/maintainers.ts), matching
      // the retirement validators.
      if (!isMaintainer(authorId) && ownerId !== authorId && !collaboratorIds.includes(authorId)) {
        errors.push(
          `**Ownership check failed**: Your GitHub account does not match the original publisher or any listed collaborator of \`${id}\`. `
          + `Only the original publisher or a listed collaborator can update this listing.`,
        );
      }

      // Without this, the weaker-authenticated path would grant strictly more
      // than the stronger one: a collaborator cannot deprecate a listing, but
      // could repoint its downloads or write themselves a caretakership.
      const activeCaretaker = getActiveCaretaker(manifest);
      const mayEditPrivileged = isMaintainer(authorId)
        || ownerId === authorId
        || (activeCaretaker !== undefined && String(activeCaretaker.github_id) === authorId);
      if (!mayEditPrivileged) {
        const attempted = PRIVILEGED_UPDATE_FIELDS.filter((field) => isPresentIssueValue(data[field]));
        if (attempted.length > 0) {
          errors.push(
            `**Authorization check failed**: ${attempted.map((f) => `\`${f}\``).join(", ")} `
            + `can only be changed by the original publisher or the active caretaker of \`${id}\`, `
            + `the same rule that governs deprecation. Leave these fields blank to update the `
            + `listing's other metadata.`,
          );
        }
      }

      if (manifestType === "map") {
        validateMapUpdateFields(manifest as MapManifest, data, errors);
        if (isPresentIssueValue(data["city-code"])) {
          const cityCode = data["city-code"] as string;
          if (loadVanillaCityCodeSet(REPO_ROOT).has(cityCode)) {
            errors.push(`**city-code**: \`${cityCode}\` clashes with a vanilla city code.`);
          }
          errors.push(...checkCityCodeUniqueness({ repoRoot: REPO_ROOT, cityCode, currentMapId: id }));
        }
      }
    }
  }

  const sourceUrl = resolveSourceUrl(data, existingManifest);
  const githubRepo = getString(data["github-repo"]);
  const customUpdateUrl = getString(data["custom-update-url"]);
  const updateType = getString(data["update-type"]);

  await validateGitHubUpdate(updateType, githubRepo, sourceUrl, manifestType, errors);
  await validateCustomUrlUpdate(updateType, customUpdateUrl, manifestType, errors);
  try {
    const collaboratorResult = await resolveCollaboratorUpdate(data.collaborators);
    errors.push(...collaboratorResult.errors.map((message) => `**collaborators**: ${message}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`**collaborators**: ${message}`);
  }
  try {
    const activeCaretakerId = existingManifest
      ? getActiveCaretaker(existingManifest)?.github_id
      : undefined;
    const caretakerResult = await resolveCaretakerUpdate(data.caretaker, activeCaretakerId);
    errors.push(...caretakerResult.errors.map((message) => `**caretaker**: ${message}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`**caretaker**: ${message}`);
  }

  if (errors.length > 0) {
    const errorMessage = [
      "Update validation failed:\n",
      ...errors.map((e) => `- ${e}`),
      "\nIf you believe this is an error, please contact a maintainer.",
    ].join("\n");

    writeFileSync(resolve(REPO_ROOT, "scripts", "validation-error.md"), errorMessage);
    console.error(errorMessage);
    process.exit(1);
  }

  console.log("Update validation passed.");
}

main();
