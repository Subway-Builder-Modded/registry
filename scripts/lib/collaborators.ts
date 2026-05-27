import { ensureAuthorAliasPrefill } from "./author-aliases.js";
import { fetchGitHubUserById, type GitHubUser } from "./github.js";

const EMPTY_UPDATE_VALUES = new Set(["", "_No response_", "No change"]);
const CLEAR_COLLABORATORS_VALUE = "None";

export type CollaboratorUpdate =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "replace"; collaborators: number[] };

export type ManifestWithCollaborators = {
  collaborators?: number[];
};

export interface CollaboratorValidationResult {
  collaborators: number[];
  users: GitHubUser[];
  errors: string[];
}

function parseCollaboratorList(value: string): number[] {
  const entries = value.split(",").map((entry) => entry.trim());
  if (
    entries.length === 0
    || entries.some((entry) => entry.length === 0)
  ) {
    throw new Error(
      "Collaborators must be a comma-separated list of GitHub user IDs with no empty entries.",
    );
  }
  const collaborators = entries.map((entry) => {
    if (!/^\d+$/.test(entry)) {
      throw new Error("Collaborators must be positive integer GitHub user IDs.");
    }
    const githubId = Number.parseInt(entry, 10);
    if (!Number.isSafeInteger(githubId) || githubId <= 0) {
      throw new Error("Collaborators must be positive integer GitHub user IDs.");
    }
    return githubId;
  });
  if (new Set(collaborators).size !== collaborators.length) {
    throw new Error("Collaborators must not contain duplicate GitHub user IDs.");
  }
  return collaborators;
}

export function parsePublishCollaborators(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (
    trimmed === ""
    || trimmed === "_No response_"
    || trimmed === CLEAR_COLLABORATORS_VALUE
  ) {
    return [];
  }
  return parseCollaboratorList(trimmed);
}

export function parseCollaboratorUpdate(value: unknown): CollaboratorUpdate {
  if (typeof value !== "string") return { kind: "keep" };
  const trimmed = value.trim();
  if (EMPTY_UPDATE_VALUES.has(trimmed)) return { kind: "keep" };
  if (trimmed === CLEAR_COLLABORATORS_VALUE) return { kind: "clear" };
  return { kind: "replace", collaborators: parseCollaboratorList(trimmed) };
}

export function applyCollaboratorUpdate(
  manifest: ManifestWithCollaborators,
  value: unknown,
): void {
  const update = parseCollaboratorUpdate(value);
  if (update.kind === "keep") return;
  if (update.kind === "clear") {
    delete manifest.collaborators;
    return;
  }
  manifest.collaborators = update.collaborators;
}

export async function validateCollaboratorGithubIds(
  collaborators: number[],
): Promise<CollaboratorValidationResult> {
  const users: GitHubUser[] = [];
  const errors: string[] = [];

  for (const githubId of collaborators) {
    const user = await fetchGitHubUserById(githubId);
    if (!user) {
      errors.push(`GitHub user ID \`${githubId}\` does not exist or is not accessible.`);
    } else {
      users.push(user);
    }
  }

  return { collaborators, users, errors };
}

export async function resolvePublishCollaborators(
  value: unknown,
): Promise<CollaboratorValidationResult> {
  return validateCollaboratorGithubIds(parsePublishCollaborators(value));
}

export async function resolveCollaboratorUpdate(
  value: unknown,
): Promise<
  | { kind: "keep"; users: GitHubUser[]; errors: string[] }
  | { kind: "clear"; users: GitHubUser[]; errors: string[] }
  | { kind: "replace"; collaborators: number[]; users: GitHubUser[]; errors: string[] }
> {
  const update = parseCollaboratorUpdate(value);
  if (update.kind !== "replace") return { ...update, users: [], errors: [] };
  const result = await validateCollaboratorGithubIds(update.collaborators);
  return { ...update, users: result.users, errors: result.errors };
}

export function ensureCollaboratorAuthorAliasPrefills(
  repoRoot: string,
  users: GitHubUser[],
): string[] {
  const created: string[] = [];
  for (const user of users) {
    const result = ensureAuthorAliasPrefill(repoRoot, user.id, user.login);
    if (result.created) {
      created.push(user.login);
    }
  }
  return created;
}
