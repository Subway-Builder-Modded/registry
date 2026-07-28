import { execFileSync } from "node:child_process";

/**
 * Shared git/GitHub history access helpers.
 *
 * The git helpers are the lenient variants (null on failure, stderr
 * suppressed, trimmed output). ops/rebuild-download-history-from-git.ts keeps
 * its own strict, throwing variants on purpose: they propagate git stderr and
 * fail loudly, which that ops tool relies on.
 */

export interface GitHubFetchOptions {
  /** Value sent as the User-Agent header. */
  userAgent: string;
  /** When set, abort the request via AbortController after this many milliseconds. */
  timeoutMs?: number;
  /** Message for non-2xx responses; defaults to `HTTP ${status}`. */
  formatHttpError?: (status: number, url: string) => string;
}

function buildGitHubHeaders(token: string, userAgent: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
  };
}

export async function fetchGitHubJson<T>(
  url: string,
  token: string,
  options: GitHubFetchOptions,
): Promise<T> {
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timeout = controller === null
    ? null
    : setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: buildGitHubHeaders(token, options.userAgent),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (!response.ok) {
      throw new Error(options.formatHttpError?.(response.status, url) ?? `HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export async function fetchGitHubArrayBuffer(
  url: string,
  token: string,
  options: GitHubFetchOptions,
): Promise<ArrayBuffer> {
  const controller = options.timeoutMs === undefined ? null : new AbortController();
  const timeout = controller === null
    ? null
    : setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: buildGitHubHeaders(token, options.userAgent),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (!response.ok) {
      throw new Error(options.formatHttpError?.(response.status, url) ?? `HTTP ${response.status}`);
    }
    // Intentionally not awaited: the timeout (when set) is cleared once the
    // headers arrive and never aborts the body read, matching the original
    // backfill implementation.
    return response.arrayBuffer();
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

/** Run a git command; trimmed stdout, or null on failure or empty output. */
export function runGitCommand(repoRoot: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === "" ? null : output;
  } catch {
    return null;
  }
}

/** Parse a JSON file as it existed at a commit; null when missing or invalid. */
export function readJsonFromCommit(
  repoRoot: string,
  commitSha: string,
  relativePath: string,
): unknown | null {
  const raw = runGitCommand(repoRoot, ["show", `${commitSha}:${relativePath}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Latest first-parent commit at or before the timestamp, or null. */
export function resolveSourceCommitAtTime(repoRoot: string, timestampIso: string): string | null {
  return runGitCommand(
    repoRoot,
    ["rev-list", "-1", "--first-parent", `--before=${timestampIso}`, "HEAD"],
  );
}
