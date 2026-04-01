import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type AttributionMethod = "github" | "discord";

export interface AuthorAliasEntry {
  github_id: number;
  author_id?: string;
  author_alias?: string;
  attribution_method?: AttributionMethod;
  discord_username?: string;
  discord_id?: string;
  attribution_link?: string;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
        author_id: typeof entry.author_id === "string" && entry.author_id.trim() !== "" ? entry.author_id.trim() : undefined,
        author_alias: typeof entry.author_alias === "string" && entry.author_alias.trim() !== ""
          ? entry.author_alias.trim()
          : undefined,
        attribution_method: (entry.attribution_method === "discord" ? "discord" : "github") as AttributionMethod,
        discord_username: typeof entry.discord_username === "string" && entry.discord_username.trim() !== ""
          ? entry.discord_username.trim()
          : undefined,
        discord_id: typeof entry.discord_id === "string" && entry.discord_id.trim() !== "" ? entry.discord_id.trim() : undefined,
        attribution_link: typeof entry.attribution_link === "string" && entry.attribution_link.trim() !== ""
          ? entry.attribution_link.trim()
          : undefined,
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

  return {
    author,
    author_alias: aliasEntry.author_alias ?? aliasEntry.author_id ?? author,
    attribution_link: aliasEntry.attribution_link ?? `https://github.com/${aliasEntry.author_id ?? author}`,
  };
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
