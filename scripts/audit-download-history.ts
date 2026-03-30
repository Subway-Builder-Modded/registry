import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DownloadHistorySnapshot } from "./lib/download-history.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

type SectionName = "maps" | "mods";

interface AuditIssue {
  severity: "error" | "warning";
  type:
    | "attributed_exceeds_raw"
    | "adjusted_decreased"
    | "raw_decreased"
    | "attributed_decreased"
    | "section_total_mismatch"
    | "top_level_total_mismatch";
  file: string;
  message: string;
}

function sumVersions(byVersion: Record<string, number> | undefined): number {
  return Object.values(byVersion ?? {}).reduce((sum, value) => sum + value, 0);
}

function sumDownloads(downloads: Record<string, Record<string, number>> | undefined): number {
  return Object.values(downloads ?? {}).reduce((sum, byVersion) => sum + sumVersions(byVersion), 0);
}

function listSnapshots(repoRoot: string): string[] {
  return readdirSync(resolve(repoRoot, "history"))
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .sort();
}

function readSnapshot(repoRoot: string, fileName: string): DownloadHistorySnapshot {
  return JSON.parse(readFileSync(resolve(repoRoot, "history", fileName), "utf-8")) as DownloadHistorySnapshot;
}

function pushIssue(
  issues: AuditIssue[],
  severity: AuditIssue["severity"],
  type: AuditIssue["type"],
  file: string,
  message: string,
): void {
  issues.push({ severity, type, file, message });
}

function auditSectionTotals(
  snapshot: DownloadHistorySnapshot,
  fileName: string,
  issues: AuditIssue[],
): void {
  for (const sectionName of ["maps", "mods"] as const) {
    const section = snapshot[sectionName];
    const adjustedTotal = sumDownloads(section.downloads);
    const rawTotal = sumDownloads(section.raw_downloads);
    const attributedTotal = sumDownloads(section.attributed_downloads);

    if (adjustedTotal !== section.total_downloads) {
      pushIssue(
        issues,
        "error",
        "section_total_mismatch",
        fileName,
        `${sectionName}.total_downloads=${section.total_downloads} but summed downloads=${adjustedTotal}`,
      );
    }
    if ((section.raw_total_downloads ?? 0) !== rawTotal) {
      pushIssue(
        issues,
        "error",
        "section_total_mismatch",
        fileName,
        `${sectionName}.raw_total_downloads=${section.raw_total_downloads ?? 0} but summed raw_downloads=${rawTotal}`,
      );
    }
    if ((section.total_attributed_downloads ?? 0) !== attributedTotal) {
      pushIssue(
        issues,
        "error",
        "section_total_mismatch",
        fileName,
        `${sectionName}.total_attributed_downloads=${section.total_attributed_downloads ?? 0} but summed attributed_downloads=${attributedTotal}`,
      );
    }
  }

  const maps = snapshot.maps;
  const mods = snapshot.mods;
  if (snapshot.total_downloads !== maps.total_downloads + mods.total_downloads) {
    pushIssue(
      issues,
      "error",
      "top_level_total_mismatch",
      fileName,
      `total_downloads=${snapshot.total_downloads} but maps+mods=${maps.total_downloads + mods.total_downloads}`,
    );
  }
  if (snapshot.raw_total_downloads !== (maps.raw_total_downloads ?? 0) + (mods.raw_total_downloads ?? 0)) {
    pushIssue(
      issues,
      "error",
      "top_level_total_mismatch",
      fileName,
      `raw_total_downloads=${snapshot.raw_total_downloads} but maps+mods=${(maps.raw_total_downloads ?? 0) + (mods.raw_total_downloads ?? 0)}`,
    );
  }
  if (snapshot.total_attributed_downloads !== (maps.total_attributed_downloads ?? 0) + (mods.total_attributed_downloads ?? 0)) {
    pushIssue(
      issues,
      "error",
      "top_level_total_mismatch",
      fileName,
      `total_attributed_downloads=${snapshot.total_attributed_downloads} but maps+mods=${(maps.total_attributed_downloads ?? 0) + (mods.total_attributed_downloads ?? 0)}`,
    );
  }
}

function auditCurrentSnapshot(snapshot: DownloadHistorySnapshot, fileName: string, issues: AuditIssue[]): void {
  for (const sectionName of ["maps", "mods"] as const) {
    const section = snapshot[sectionName];
    const listingIds = new Set<string>([
      ...Object.keys(section.downloads ?? {}),
      ...Object.keys(section.raw_downloads ?? {}),
      ...Object.keys(section.attributed_downloads ?? {}),
    ]);
    for (const listingId of [...listingIds].sort()) {
      const adjusted = section.downloads?.[listingId] ?? {};
      const raw = section.raw_downloads?.[listingId] ?? {};
      const attributed = section.attributed_downloads?.[listingId] ?? {};
      const versions = new Set<string>([
        ...Object.keys(adjusted),
        ...Object.keys(raw),
        ...Object.keys(attributed),
      ]);
      for (const version of [...versions].sort()) {
        const rawCount = raw[version] ?? 0;
        const attributedCount = attributed[version] ?? 0;
        if (attributedCount > rawCount) {
          pushIssue(
            issues,
            "error",
            "attributed_exceeds_raw",
            fileName,
            `${sectionName}:${listingId}@${version} has attributed=${attributedCount} > raw=${rawCount}`,
          );
        }
      }
    }
  }
}

function auditMonotonicPair(
  previous: DownloadHistorySnapshot,
  current: DownloadHistorySnapshot,
  currentFileName: string,
  issues: AuditIssue[],
): void {
  for (const sectionName of ["maps", "mods"] as const) {
    const prevSection = previous[sectionName];
    const currSection = current[sectionName];
    const listingIds = new Set<string>([
      ...Object.keys(prevSection.downloads ?? {}),
      ...Object.keys(currSection.downloads ?? {}),
      ...Object.keys(prevSection.raw_downloads ?? {}),
      ...Object.keys(currSection.raw_downloads ?? {}),
      ...Object.keys(prevSection.attributed_downloads ?? {}),
      ...Object.keys(currSection.attributed_downloads ?? {}),
    ]);
    for (const listingId of [...listingIds].sort()) {
      const prevAdjusted = sumVersions(prevSection.downloads?.[listingId]);
      const currAdjusted = sumVersions(currSection.downloads?.[listingId]);
      const prevRaw = sumVersions(prevSection.raw_downloads?.[listingId]);
      const currRaw = sumVersions(currSection.raw_downloads?.[listingId]);
      const prevAttributed = sumVersions(prevSection.attributed_downloads?.[listingId]);
      const currAttributed = sumVersions(currSection.attributed_downloads?.[listingId]);

      if (currAdjusted < prevAdjusted) {
        pushIssue(
          issues,
          "warning",
          "adjusted_decreased",
          currentFileName,
          `${sectionName}:${listingId} adjusted decreased ${prevAdjusted} -> ${currAdjusted}`,
        );
      }
      if (currRaw < prevRaw) {
        pushIssue(
          issues,
          "warning",
          "raw_decreased",
          currentFileName,
          `${sectionName}:${listingId} raw decreased ${prevRaw} -> ${currRaw}`,
        );
      }
      if (currAttributed < prevAttributed) {
        pushIssue(
          issues,
          "warning",
          "attributed_decreased",
          currentFileName,
          `${sectionName}:${listingId} attributed decreased ${prevAttributed} -> ${currAttributed}`,
        );
      }
    }
  }
}

function summarizeIssues(issues: AuditIssue[]): void {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.type}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  console.log("[audit-download-history] Summary");
  for (const key of [...counts.keys()].sort()) {
    console.log(`[audit-download-history] ${key}=${counts.get(key) ?? 0}`);
  }

  const topWarnings = issues
    .filter((issue) => issue.severity === "warning")
    .slice(0, 25);
  const topErrors = issues
    .filter((issue) => issue.severity === "error")
    .slice(0, 25);

  if (topErrors.length > 0) {
    console.log("[audit-download-history] Sample errors:");
    for (const issue of topErrors) {
      console.log(`[audit-download-history] ${issue.file}: ${issue.message}`);
    }
  }

  if (topWarnings.length > 0) {
    console.log("[audit-download-history] Sample warnings:");
    for (const issue of topWarnings) {
      console.log(`[audit-download-history] ${issue.file}: ${issue.message}`);
    }
  }
}

function run(): void {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const snapshotFiles = listSnapshots(repoRoot);
  const issues: AuditIssue[] = [];
  let previous: DownloadHistorySnapshot | null = null;

  for (const fileName of snapshotFiles) {
    const current = readSnapshot(repoRoot, fileName);
    auditSectionTotals(current, fileName, issues);
    auditCurrentSnapshot(current, fileName, issues);
    if (previous) {
      auditMonotonicPair(previous, current, fileName, issues);
    }
    previous = current;
  }

  summarizeIssues(issues);

  const hasErrors = issues.some((issue) => issue.severity === "error");
  if (hasErrors) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run();
}
