import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOptionalIssueValue } from "./lib/map-field-utils.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..");

const DISCORD_SNOWFLAKE_RE = /^\d{17,19}$/;

function writeValidationError(repoRoot: string, errors: string[]): void {
  const errorMessage = [
    "Update validation failed:\n",
    ...errors.map((e) => `- ${e}`),
    "\nIf you believe this is an error, please contact a maintainer.",
  ].join("\n");
  writeFileSync(resolve(repoRoot, "scripts", "validation-error.md"), errorMessage);
  console.error(errorMessage);
}

async function main() {
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorId = process.env.ISSUE_AUTHOR_ID;

  if (!issueJson || !issueAuthorId) {
    console.error("ISSUE_JSON and ISSUE_AUTHOR_ID environment variables are required");
    process.exit(1);
  }

  const authorId = Number(issueAuthorId);
  if (!Number.isFinite(authorId) || authorId <= 0) {
    writeValidationError(REPO_ROOT, [
      "**Author ID**: Invalid author ID. This is an internal error — please contact a maintainer.",
    ]);
    process.exit(1);
  }

  const data = JSON.parse(issueJson) as Record<string, unknown>;
  const errors: string[] = [];

  const authorAlias = getOptionalIssueValue(data["author-alias"]);
  const attributionMethod = getOptionalIssueValue(data["attribution-method"]);
  const attributionLink = getOptionalIssueValue(data["attribution-link"]);
  const discordUsername = getOptionalIssueValue(data["discord-username"]);
  const discordId = getOptionalIssueValue(data["discord-id"]);
  const koFiUsername = getOptionalIssueValue(data["ko-fi-username"]);

  const hasAnyField = [authorAlias, attributionMethod, attributionLink, discordUsername, discordId, koFiUsername].some(
    (v) => v !== undefined,
  );

  if (!hasAnyField) {
    errors.push("No fields were filled in. Please provide at least one field to update.");
  }

  if (attributionMethod === "Custom" && attributionLink === undefined) {
    errors.push('**attribution-link**: A URL is required when Attribution Method is "Custom".');
  }

  if (attributionLink !== undefined) {
    try {
      const url = new URL(attributionLink);
      if (url.protocol !== "https:") {
        errors.push("**attribution-link**: Must be an HTTPS URL.");
      }
    } catch {
      errors.push("**attribution-link**: Must be a valid URL.");
    }
  }

  if (discordId !== undefined && !DISCORD_SNOWFLAKE_RE.test(discordId)) {
    errors.push("**discord-id**: Must be a 17–19 digit numeric Discord user ID.");
  }

  if (errors.length > 0) {
    writeValidationError(REPO_ROOT, errors);
    process.exit(1);
  }

  console.log("Author update validation passed.");
}

main();
