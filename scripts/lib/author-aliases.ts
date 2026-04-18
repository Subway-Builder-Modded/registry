import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isObject } from "./json-utils.js";

export type AttributionMethod = "github" | "discord" | "custom";
export type ContributorTier = "developer" | "executive" | "engineer" | "collaborator";

export interface AuthorAliasEntry {
  github_id: number;
  author_id?: string;
  author_alias?: string;
  attribution_method?: AttributionMethod;
  discord_username?: string;
  discord_id?: string;
  attribution_link?: string;
  ko_fi_username?: string;
  contributor_tier?: ContributorTier;
}

export interface AuthorAliasIndex {
  schema_version: 1;
  authors: AuthorAliasEntry[];
}

export interface ResolvedAuthorPresentation {
  author: string;
  author_alias: string;
  attribution_link: string;
}

export interface EnsureAuthorAliasPrefillResult {
  created: boolean;
  path: string;
}

function parseAttributionMethod(value: unknown): AttributionMethod {
  if (value === "discord" || value === "custom") return value;
  return "github";
}

function parseContributorTier(value: unknown): ContributorTier | undefined {
  if (value === "developer" || value === "executive" || value === "engineer" || value === "collaborator") {
    return value;
  }
  return undefined;
}

function trimmedStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed !== "" ? trimmed : undefined;
}

export function getAuthorAliasIndexPath(repoRoot: string): string {
  return resolve(repoRoot, "authors", "index.json");
}

export function loadAuthorAliasIndex(repoRoot: string): AuthorAliasIndex {
  const path = getAuthorAliasIndexPath(repoRoot);
  if (!existsSync(path)) {
    return { schema_version: 1, authors: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isObject(raw) || raw.schema_version !== 1 || !Array.isArray(raw.authors)) {
      return { schema_version: 1, authors: [] };
    }

    const authors = raw.authors
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => ({
        github_id: typeof entry.github_id === "number" && Number.isFinite(entry.github_id) ? entry.github_id : 0,
        author_id: trimmedStringOrUndefined(entry.author_id),
        author_alias: trimmedStringOrUndefined(entry.author_alias),
        attribution_method: parseAttributionMethod(entry.attribution_method),
        discord_username: trimmedStringOrUndefined(entry.discord_username),
        discord_id: trimmedStringOrUndefined(entry.discord_id),
        attribution_link: trimmedStringOrUndefined(entry.attribution_link),
        ko_fi_username: trimmedStringOrUndefined(entry.ko_fi_username),
        contributor_tier: parseContributorTier(entry.contributor_tier),
      }))
      .filter((entry) => entry.github_id > 0)
      .sort((a, b) => a.github_id - b.github_id);

    return {
      schema_version: 1,
      authors,
    };
  } catch {
    return { schema_version: 1, authors: [] };
  }
}

export function resolveAuthorPresentation(
  author: string,
  githubId: number | null,
  aliases: AuthorAliasIndex,
): ResolvedAuthorPresentation {
  const fallbackLink = `https://github.com/${author}`;
  if (githubId === null) {
    return {
      author,
      author_alias: author,
      attribution_link: fallbackLink,
    };
  }

  const aliasEntry = aliases.authors.find((entry) => entry.github_id === githubId);
  if (!aliasEntry) {
    return {
      author,
      author_alias: author,
      attribution_link: fallbackLink,
    };
  }

  if (aliasEntry.attribution_method === "discord" && aliasEntry.discord_id) {
    return {
      author,
      author_alias: aliasEntry.author_alias ?? aliasEntry.author_id ?? author,
      attribution_link: aliasEntry.attribution_link ?? `https://discord.com/users/${aliasEntry.discord_id}`,
    };
  }

  if (aliasEntry.attribution_method === "custom") {
    return {
      author,
      author_alias: aliasEntry.author_alias ?? aliasEntry.author_id ?? author,
      attribution_link: aliasEntry.attribution_link ?? fallbackLink,
    };
  }

  return {
    author,
    author_alias: aliasEntry.author_alias ?? aliasEntry.author_id ?? author,
    attribution_link: aliasEntry.attribution_link ?? `https://github.com/${aliasEntry.author_id ?? author}`,
  };
}

export interface AuthorAliasUpdates {
  author_alias?: string;
  attribution_method?: AttributionMethod;
  attribution_link?: string;
  discord_username?: string;
  discord_id?: string;
  ko_fi_username?: string;
}

export function updateAuthorEntry(
  index: AuthorAliasIndex,
  githubId: number,
  login: string,
  updates: AuthorAliasUpdates,
): AuthorAliasIndex {
  const existing = index.authors.find((e) => e.github_id === githubId);
  let entry: AuthorAliasEntry = existing
    ? { ...existing }
    : {
      github_id: githubId,
      author_id: login,
      author_alias: login,
      attribution_method: "github" as AttributionMethod,
      attribution_link: `https://github.com/${login}`,
    };

  if (updates.author_alias !== undefined) entry.author_alias = updates.author_alias;
  if (updates.discord_username !== undefined) entry.discord_username = updates.discord_username;
  if (updates.discord_id !== undefined) entry.discord_id = updates.discord_id;
  if (updates.ko_fi_username !== undefined) entry.ko_fi_username = updates.ko_fi_username;

  if (updates.attribution_method !== undefined) {
    entry.attribution_method = updates.attribution_method;
    if (updates.attribution_method === "github" && existing?.attribution_method !== "github") {
      entry.attribution_link = undefined;
    }
  }

  if (updates.attribution_link !== undefined) {
    entry.attribution_link = updates.attribution_link;
  }

  const authors = [
    ...index.authors.filter((e) => e.github_id !== githubId),
    entry,
  ].sort((a, b) => a.github_id - b.github_id);

  return { schema_version: 1, authors };
}

export function ensureAuthorAliasPrefill(
  repoRoot: string,
  githubId: number,
  authorLogin: string,
): EnsureAuthorAliasPrefillResult {
  const path = getAuthorAliasIndexPath(repoRoot);
  const normalizedAuthorLogin = authorLogin.trim();
  if (!Number.isFinite(githubId) || githubId <= 0 || normalizedAuthorLogin === "") {
    return { created: false, path };
  }

  const index = loadAuthorAliasIndex(repoRoot);
  const existing = index.authors.find((entry) => entry.github_id === githubId);
  if (existing) {
    return { created: false, path };
  }

  const authors: AuthorAliasEntry[] = [
    ...index.authors,
    {
      github_id: githubId,
      author_id: normalizedAuthorLogin,
      author_alias: normalizedAuthorLogin,
      attribution_method: "github" as AttributionMethod,
      attribution_link: `https://github.com/${normalizedAuthorLogin}`,
    },
  ].sort((a, b) => a.github_id - b.github_id);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ schema_version: 1, authors }, null, 2)}\n`,
    "utf-8",
  );

  return { created: true, path };
}
