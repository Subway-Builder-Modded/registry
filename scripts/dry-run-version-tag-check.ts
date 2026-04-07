/**
 * Dry-run script for the mod version-tag integrity check.
 *
 * Reads the existing integrity cache and downloads data, fetches ZIPs for
 * currently-complete versions, extracts manifest.json version, and compares
 * against the version key. Optionally fetches GitHub release asset download
 * counts when GH_TOKEN is provided.
 *
 * Usage:
 *   cd scripts
 *   GH_TOKEN=ghp_... npx tsx dry-run-version-tag-check.ts
 *   npx tsx dry-run-version-tag-check.ts          # without GitHub counts
 *
 * Output: TSV to stdout (pipe to file if needed).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { parseStableSemverTag, normalizeStableSemverTag } from "./lib/semver.js";

const repoRoot = resolve(import.meta.dirname, "..");
const cacheRaw = JSON.parse(readFileSync(resolve(repoRoot, "mods", "integrity-cache.json"), "utf-8")) as {
  entries: Record<string, Record<string, {
    result: {
      is_complete: boolean;
      errors: string[];
      source: {
        update_type: string;
        repo?: string;
        tag?: string;
        asset_name?: string;
        download_url?: string;
      };
    };
  }>>;
};
const downloads = JSON.parse(readFileSync(resolve(repoRoot, "mods", "downloads.json"), "utf-8")) as
  Record<string, Record<string, number>>;

const GH_TOKEN = process.env.GH_TOKEN || process.env.GH_DOWNLOADS_TOKEN || process.env.GITHUB_TOKEN || "";

// ── GitHub release asset download counts ──

interface ReleaseAssetCounts {
  [assetName: string]: number;
}

const releaseCountCache = new Map<string, ReleaseAssetCounts>();

async function fetchReleaseAssetCounts(repo: string, tag: string): Promise<ReleaseAssetCounts> {
  const key = `${repo}:${tag}`;
  const cached = releaseCountCache.get(key);
  if (cached) return cached;

  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "railyard-dry-run",
  };
  if (GH_TOKEN) headers.Authorization = `Bearer ${GH_TOKEN}`;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[warn] GitHub API ${res.status} for ${repo}@${tag}`);
      const empty: ReleaseAssetCounts = {};
      releaseCountCache.set(key, empty);
      return empty;
    }
    const data = (await res.json()) as {
      assets: { name: string; download_count: number }[];
    };
    const counts: ReleaseAssetCounts = {};
    for (const asset of data.assets) {
      counts[asset.name] = asset.download_count;
    }
    releaseCountCache.set(key, counts);
    return counts;
  } catch (err) {
    console.error(`[warn] GitHub API error for ${repo}@${tag}: ${err}`);
    const empty: ReleaseAssetCounts = {};
    releaseCountCache.set(key, empty);
    return empty;
  }
}

// ── ZIP manifest version extraction ──

async function extractManifestVersion(downloadUrl: string): Promise<string | null> {
  try {
    const res = await fetch(downloadUrl, {
      headers: { "User-Agent": "railyard-dry-run" },
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[warn] fetch ${res.status} for ${downloadUrl}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    const manifestEntry = zip.files["manifest.json"];
    if (!manifestEntry) return null;
    const raw = await manifestEntry.async("string");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.version === "string") return parsed.version.trim();
    return null;
  } catch (err) {
    console.error(`[warn] ZIP error for ${downloadUrl}: ${err}`);
    return null;
  }
}

// ── Main ──

interface Row {
  modId: string;
  version: string;
  status: "valid" | "invalid" | "already_incomplete" | "error";
  reason: string;
  manifestVersion: string;
  adjustedDownloads: number;
  rawModDownloads: number | string;
  rawManifestDownloads: number | string;
}

async function run(): Promise<void> {
  const rows: Row[] = [];
  const entries = Object.entries(cacheRaw.entries);

  // Collect work items
  const workItems: {
    modId: string;
    version: string;
    entry: (typeof cacheRaw.entries)[string][string];
  }[] = [];

  for (const [modId, versions] of entries) {
    for (const [version, entry] of Object.entries(versions)) {
      workItems.push({ modId, version, entry });
    }
  }

  const totalComplete = workItems.filter((w) => w.entry.result.is_complete).length;
  console.error(`Found ${workItems.length} total cached versions, ${totalComplete} currently complete`);
  console.error(`Fetching ZIPs for ${totalComplete} complete versions...\n`);

  let processed = 0;

  for (const { modId, version, entry } of workItems) {
    const result = entry.result;
    const adjustedDownloads = downloads[modId]?.[version] ?? 0;

    if (!result.is_complete) {
      rows.push({
        modId,
        version,
        status: "already_incomplete",
        reason: result.errors.join("; "),
        manifestVersion: "",
        adjustedDownloads,
        rawModDownloads: "",
        rawManifestDownloads: "",
      });
      continue;
    }

    // This version is currently complete — check manifest version
    const downloadUrl = result.source.download_url;
    if (!downloadUrl) {
      rows.push({
        modId,
        version,
        status: "error",
        reason: "no download_url in cache",
        manifestVersion: "",
        adjustedDownloads,
        rawModDownloads: "",
        rawManifestDownloads: "",
      });
      continue;
    }

    processed++;
    console.error(`  [${processed}/${totalComplete}] ${modId}@${version}`);

    const manifestVersion = await extractManifestVersion(downloadUrl);

    // Determine expected version: use the version key (same as params.version in pipeline)
    const normalizedTag = normalizeStableSemverTag(version);
    const normalizedManifest = manifestVersion ? normalizeStableSemverTag(manifestVersion) : null;

    let status: Row["status"];
    let reason: string;

    if (!normalizedTag) {
      // Non-semver version key — check would be skipped
      status = "valid";
      reason = "non-semver version key (check skipped)";
    } else if (normalizedManifest === null) {
      status = "invalid";
      reason = `manifest.json version '${manifestVersion ?? "(missing)"}' (expected '${normalizedTag}')`;
    } else if (normalizedManifest !== normalizedTag) {
      status = "invalid";
      reason = `manifest version '${manifestVersion}' → '${normalizedManifest}' ≠ tag '${version}' → '${normalizedTag}'`;
    } else {
      status = "valid";
      reason = "";
    }

    // GitHub download counts (if token provided)
    let rawModDownloads: number | string = "";
    let rawManifestDownloads: number | string = "";
    if (GH_TOKEN && result.source.repo && result.source.tag) {
      const counts = await fetchReleaseAssetCounts(result.source.repo, result.source.tag);
      rawModDownloads = result.source.asset_name ? (counts[result.source.asset_name] ?? "") : "";
      rawManifestDownloads = counts["manifest.json"] ?? "";
    }

    rows.push({
      modId,
      version,
      status,
      reason,
      manifestVersion: manifestVersion ?? "(missing)",
      adjustedDownloads,
      rawModDownloads,
      rawManifestDownloads,
    });
  }

  // ── Output TSV ──
  const header = [
    "mod_id",
    "version",
    "status",
    "reason",
    "manifest_version",
    "adjusted_downloads",
    ...(GH_TOKEN ? ["raw_mod_downloads", "raw_manifest_downloads"] : []),
  ].join("\t");

  console.log(header);
  for (const row of rows) {
    const fields = [
      row.modId,
      row.version,
      row.status,
      row.reason,
      row.manifestVersion,
      String(row.adjustedDownloads),
      ...(GH_TOKEN ? [String(row.rawModDownloads), String(row.rawManifestDownloads)] : []),
    ];
    console.log(fields.join("\t"));
  }

  // ── Summary ──
  const invalid = rows.filter((r) => r.status === "invalid");
  const valid = rows.filter((r) => r.status === "valid");
  const alreadyIncomplete = rows.filter((r) => r.status === "already_incomplete");
  const affectedDownloads = invalid.reduce((sum, r) => sum + r.adjustedDownloads, 0);

  console.error(`\n${"─".repeat(60)}`);
  console.error(`Summary:`);
  console.error(`  Already incomplete:  ${alreadyIncomplete.length}`);
  console.error(`  Valid (pass check):  ${valid.length}`);
  console.error(`  Invalid (new fail):  ${invalid.length}`);
  console.error(`  Affected downloads:  ${affectedDownloads}`);
  if (invalid.length > 0) {
    console.error(`\nNewly caught versions:`);
    for (const r of invalid) {
      console.error(`  ${r.modId}@${r.version}  (${r.adjustedDownloads} downloads)  ${r.reason}`);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
