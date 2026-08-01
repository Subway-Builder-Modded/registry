import type { CaretakerWindow } from "@subway-builder-modded/registry-schemas";
import { fetchGitHubUserById, type GitHubUser } from "./github.js";

const EMPTY_UPDATE_VALUES = new Set(["", "_No response_", "No change"]);
const CLEAR_CARETAKER_VALUE = "None";

export type { CaretakerWindow };

export type ManifestWithCaretakers = {
  collaborators?: number[];
  caretakers?: CaretakerWindow[];
};

export type CaretakerUpdate =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "replace"; githubId: number };

export interface CaretakerValidationResult {
  githubId: number | null;
  users: GitHubUser[];
  errors: string[];
}

function parseCaretakerId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Caretaker must be a single positive integer GitHub user ID.");
  }
  const githubId = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(githubId) || githubId <= 0) {
    throw new Error("Caretaker must be a single positive integer GitHub user ID.");
  }
  return githubId;
}

export function parsePublishCaretaker(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed === ""
    || trimmed === "_No response_"
    || trimmed === CLEAR_CARETAKER_VALUE
  ) {
    return null;
  }
  return parseCaretakerId(trimmed);
}

export function parseCaretakerUpdate(value: unknown): CaretakerUpdate {
  if (typeof value !== "string") return { kind: "keep" };
  const trimmed = value.trim();
  if (EMPTY_UPDATE_VALUES.has(trimmed)) return { kind: "keep" };
  if (trimmed === CLEAR_CARETAKER_VALUE) return { kind: "clear" };
  return { kind: "replace", githubId: parseCaretakerId(trimmed) };
}

/** The active caretaker entry (no `until`), which validation forces to be last. */
export function getActiveCaretaker(
  manifest: ManifestWithCaretakers,
): CaretakerWindow | undefined {
  const caretakers = manifest.caretakers;
  if (!Array.isArray(caretakers) || caretakers.length === 0) return undefined;
  const last = caretakers[caretakers.length - 1];
  return last && last.until === undefined ? last : undefined;
}

function unionCollaborator(manifest: ManifestWithCaretakers, githubId: number): void {
  const collaborators = Array.isArray(manifest.collaborators)
    ? manifest.collaborators
    : [];
  if (!collaborators.includes(githubId)) collaborators.push(githubId);
  manifest.collaborators = collaborators;
}

/**
 * Applies a caretaker form value to a manifest (listing-type-agnostic):
 * - blank / "_No response_" / "No change" → no change;
 * - "None" → close the active caretaker window (stamp `until: nowIso`);
 * - numeric id → error if it equals the active caretaker; otherwise close the
 *   active window (if any), append `{github_id, since: nowIso}`, and union the
 *   id into `collaborators` (caretaker ⇒ collaborator keeps ownership checks
 *   working unchanged).
 * Returns the parsed update so callers can log / prefill aliases.
 */
export function applyCaretakerUpdate(
  manifest: ManifestWithCaretakers,
  value: unknown,
  nowIso: string,
): CaretakerUpdate {
  const update = parseCaretakerUpdate(value);
  if (update.kind === "keep") return update;

  const active = getActiveCaretaker(manifest);
  if (update.kind === "clear") {
    if (active) active.until = nowIso;
    return update;
  }

  if (active && active.github_id === update.githubId) {
    throw new Error(
      `GitHub user ID \`${update.githubId}\` is already the active caretaker.`,
    );
  }
  if (active) active.until = nowIso;
  const caretakers = Array.isArray(manifest.caretakers) ? manifest.caretakers : [];
  caretakers.push({ github_id: update.githubId, since: nowIso });
  manifest.caretakers = caretakers;
  unionCollaborator(manifest, update.githubId);
  return update;
}

async function validateCaretakerGithubId(
  githubId: number,
): Promise<CaretakerValidationResult> {
  const user = await fetchGitHubUserById(githubId);
  if (!user) {
    return {
      githubId,
      users: [],
      errors: [`GitHub user ID \`${githubId}\` does not exist or is not accessible.`],
    };
  }
  return { githubId, users: [user], errors: [] };
}

export async function resolvePublishCaretaker(
  value: unknown,
): Promise<CaretakerValidationResult> {
  const githubId = parsePublishCaretaker(value);
  if (githubId === null) return { githubId: null, users: [], errors: [] };
  return validateCaretakerGithubId(githubId);
}

export async function resolveCaretakerUpdate(
  value: unknown,
  activeCaretakerId?: number,
): Promise<{ update: CaretakerUpdate; users: GitHubUser[]; errors: string[] }> {
  const update = parseCaretakerUpdate(value);
  if (update.kind !== "replace") return { update, users: [], errors: [] };
  if (activeCaretakerId !== undefined && update.githubId === activeCaretakerId) {
    return {
      update,
      users: [],
      errors: [
        `GitHub user ID \`${update.githubId}\` is already the active caretaker.`,
      ],
    };
  }
  const result = await validateCaretakerGithubId(update.githubId);
  return { update, users: result.users, errors: result.errors };
}
