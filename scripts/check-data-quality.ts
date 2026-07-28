import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DataQualityAnswersFileSchema } from "@subway-builder-modded/registry-schemas";
import { readJsonFile } from "./lib/json-utils.js";
import {
  buildProvisionalReport,
  checkMapDataQuality,
  type ReportEntry,
} from "./lib/data-quality-check.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const MAPS_DIR = resolve(REPO_ROOT, "maps");

function listMapIds(): string[] {
  return readdirSync(MAPS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(MAPS_DIR, entry.name, "manifest.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

function readJsonIfExists(path: string): unknown {
  return existsSync(path) ? readJsonFile<unknown>(path) : undefined;
}

/**
 * Report mode: `--report <maps/<id>/data-quality.json ...>` emits the
 * provisional-score markdown for the PR comment to stdout. Validation problems
 * appear inside the report; the check mode is what fails CI.
 */
function runReport(paths: string[]): void {
  const entries: ReportEntry[] = paths.map((path) => {
    const absolute = resolve(REPO_ROOT, path);
    if (!existsSync(absolute)) {
      return { path, error: "file not found (deleted in this PR?)" };
    }
    try {
      const raw = readJsonFile<unknown>(absolute);
      const id = path.replace(/\\/g, "/").split("/").at(-2) ?? "";
      // Read the manifest too: without it, confirmed answers files would trip
      // the "manifest not stamped" consistency rule even when the same PR
      // stamps the manifest (the check job remains the authoritative gate).
      const manifest = readJsonIfExists(resolve(MAPS_DIR, id, "manifest.json")) as
        | Record<string, unknown>
        | undefined;
      const errors = checkMapDataQuality({
        id,
        manifestDataQuality: manifest?.data_quality,
        answersFile: raw,
      });
      if (errors.length > 0) {
        return { path, error: errors.join("; ") };
      }
      // checkMapDataQuality parsed successfully; re-parse is cheap and typed.
      return { path, file: DataQualityAnswersFileSchema.parse(raw) };
    } catch (error) {
      return { path, error: error instanceof Error ? error.message : String(error) };
    }
  });
  process.stdout.write(`${buildProvisionalReport(entries)}\n`);
}

function runCheck(requirePresence: boolean, requireScoredIds: string[]): void {
  const ids = listMapIds();
  const errors: string[] = [];
  let scored = 0;
  let withAnswers = 0;
  const scoredIds = new Set<string>();

  for (const id of ids) {
    const manifest = readJsonFile<Record<string, unknown>>(
      resolve(MAPS_DIR, id, "manifest.json"),
    );
    const answersFile = readJsonIfExists(resolve(MAPS_DIR, id, "data-quality.json"));
    if (answersFile !== undefined) withAnswers += 1;
    const dataQuality = manifest.data_quality;
    if (
      dataQuality !== undefined &&
      typeof dataQuality === "object" &&
      dataQuality !== null &&
      (dataQuality as Record<string, unknown>).tier !== "unknown"
    ) {
      scored += 1;
      scoredIds.add(id);
    }
    errors.push(
      ...checkMapDataQuality(
        { id, manifestDataQuality: dataQuality, answersFile },
        { requirePresence },
      ),
    );
  }

  // Publish gate (plan C1.3): manifests newly added in a PR must carry a
  // confirmed scored block before the PR can merge. The workflow computes the
  // added ids; the dq-grandfathered label bypasses this rule entirely.
  for (const id of requireScoredIds) {
    if (scoredIds.has(id)) continue;
    errors.push(
      `maps/${id}: new maps require a confirmed data-quality tier before merge — ` +
        `the author answers the data-quality questions (see the publish issue's invite), ` +
        `then a maintainer confirms with the \`rescore_data\` PR comment. ` +
        `Maintainers can exempt this PR with the \`dq-grandfathered\` label.`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`\n${errors.length} data-quality error(s) across ${ids.length} maps.`);
    process.exit(1);
  }
  console.log(
    `Data quality OK: ${ids.length} maps checked (${scored} scored, ${withAnswers} with answers files).`,
  );
}

const args = process.argv.slice(2);
const reportIndex = args.indexOf("--report");
if (reportIndex !== -1) {
  runReport(args.slice(reportIndex + 1).filter((a) => !a.startsWith("--")));
} else {
  const requireScoredIndex = args.indexOf("--require-scored");
  const requireScoredIds =
    requireScoredIndex === -1
      ? []
      : args.slice(requireScoredIndex + 1).filter((a) => !a.startsWith("--"));
  runCheck(args.includes("--require-presence"), requireScoredIds);
}
