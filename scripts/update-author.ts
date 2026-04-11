import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getOptionalIssueValue } from "./lib/map-field-utils.js";
import {
  loadAuthorAliasIndex,
  updateAuthorEntry,
  getAuthorAliasIndexPath,
  type AttributionMethod,
} from "./lib/author-aliases.js";
import { writeJsonFile } from "./lib/json-utils.js";

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..");

async function main() {
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorId = process.env.ISSUE_AUTHOR_ID;
  const issueAuthorLogin = process.env.ISSUE_AUTHOR_LOGIN;

  if (!issueJson || !issueAuthorId || !issueAuthorLogin) {
    console.error("ISSUE_JSON, ISSUE_AUTHOR_ID, and ISSUE_AUTHOR_LOGIN environment variables are required");
    process.exit(1);
  }

  const githubId = Number(issueAuthorId);
  const login = issueAuthorLogin.trim();
  const data = JSON.parse(issueJson) as Record<string, unknown>;

  const authorAlias = getOptionalIssueValue(data["author-alias"]);
  const attributionMethodRaw = getOptionalIssueValue(data["attribution-method"]);
  const attributionMethod: AttributionMethod | undefined =
    attributionMethodRaw === "GitHub" ? "github"
    : attributionMethodRaw === "Custom" ? "custom"
    : undefined;
  const attributionLink = getOptionalIssueValue(data["attribution-link"]);
  const discordUsername = getOptionalIssueValue(data["discord-username"]);
  const discordId = getOptionalIssueValue(data["discord-id"]);
  const koFiUsername = getOptionalIssueValue(data["ko-fi-username"]);

  const index = loadAuthorAliasIndex(REPO_ROOT);
  const updatedIndex = updateAuthorEntry(index, githubId, login, {
    author_alias: authorAlias,
    attribution_method: attributionMethod,
    attribution_link: attributionLink,
    discord_username: discordUsername,
    discord_id: discordId,
    ko_fi_username: koFiUsername,
  });

  const path = getAuthorAliasIndexPath(REPO_ROOT);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFile(path, updatedIndex);
  console.log(`Updated authors/index.json for ${login} (id: ${githubId})`);
}

main();
