import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DataQualityAnswersFileSchema,
  RUBRIC_VERSION,
  type DataQualityAnswersFile,
} from "@subway-builder-modded/registry-schemas";
import { readJsonFile } from "../lib/json-utils.js";
import {
  parseDataQualityIssue,
  resolveInheritance,
  type InheritanceCandidate,
} from "../lib/data-quality-issue.js";
import {
  buildProvisionalReport,
  checkMapDataQuality,
} from "../lib/data-quality-check.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const MAPS_DIR = resolve(REPO_ROOT, "maps");
const ERROR_PATH = resolve(REPO_ROOT, "dq-validation-error.md");
const REPORT_PATH = resolve(REPO_ROOT, "dq-validation-report.md");

function fail(errors: string[]): never {
  const body = [
    "### Data-quality validation failed",
    "",
    ...errors.map((error) => `- ${error}`),
    "",
    "Edit the issue and comment **revalidate** to retry.",
  ].join("\n");
  writeFileSync(ERROR_PATH, `${body}\n`);
  console.error(body);
  process.exit(1);
}

function readJsonIfExists<T>(path: string): T | undefined {
  return existsSync(path) ? readJsonFile<T>(path) : undefined;
}

function main(): void {
  const issueJson = process.env.ISSUE_JSON;
  const issueAuthorLogin = process.env.ISSUE_AUTHOR_LOGIN;
  if (!issueJson || !issueAuthorLogin) {
    console.error("ISSUE_JSON and ISSUE_AUTHOR_LOGIN are required");
    process.exit(1);
  }

  const data = JSON.parse(issueJson) as Record<string, unknown>;
  const { input, errors } = parseDataQualityIssue(data);
  if (!input) fail(errors);

  // The workflow checks out the open publish/map/<id> branch first when the
  // map is not yet on main, so an unmerged submission's manifest is present
  // here too. Reaching this failure means neither exists.
  const manifestPath = resolve(MAPS_DIR, input.mapId, "manifest.json");
  if (!existsSync(manifestPath)) {
    fail([
      `**map-id**: No map \`${input.mapId}\` exists in the registry or in a pending publish submission. Submit the map first (**Publish New Map**) — the data-quality invite follows automatically.`,
    ]);
  }
  const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
  if (manifest.author !== issueAuthorLogin) {
    fail([
      `**map-id**: \`${input.mapId}\` is published by \`${manifest.author}\`; data-quality answers must be submitted by the map's author.`,
    ]);
  }

  let answers = input.answers;
  let derivedFrom: string | undefined;
  let sampleIds: string[] = [];
  if (input.sameMethodology) {
    const country = String(manifest.country ?? "");
    const candidates: InheritanceCandidate[] = [];
    for (const entry of readdirSync(MAPS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === input.mapId) continue;
      const otherManifest = readJsonIfExists<Record<string, unknown>>(
        resolve(MAPS_DIR, entry.name, "manifest.json"),
      );
      if (
        !otherManifest ||
        otherManifest.author !== issueAuthorLogin ||
        otherManifest.country !== country
      ) {
        continue;
      }
      const answersFileRaw = readJsonIfExists<unknown>(
        resolve(MAPS_DIR, entry.name, "data-quality.json"),
      );
      const parsed = DataQualityAnswersFileSchema.safeParse(answersFileRaw);
      if (!parsed.success) continue;
      if (
        parsed.data.provenance.method !== "reviewed" &&
        parsed.data.provenance.method !== "backfill"
      ) {
        continue;
      }
      candidates.push({
        id: entry.name,
        lastUpdated:
          typeof otherManifest.last_updated === "number"
            ? otherManifest.last_updated
            : 0,
        answersFile: parsed.data,
      });
    }
    const inheritance = resolveInheritance(candidates);
    if (!inheritance.source) {
      fail([`**same-methodology**: ${inheritance.error}`]);
    }
    answers = inheritance.source.answersFile.answers;
    derivedFrom = inheritance.source.id;
    sampleIds = inheritance.sample.map((candidate) => candidate.id);
  }

  const date = new Date().toISOString().slice(0, 10);
  const answersFile: DataQualityAnswersFile = DataQualityAnswersFileSchema.parse({
    schema_version: 1,
    id: input.mapId,
    answers,
    notes: input.methodology,
    ...(input.sources.length > 0 ? { sources: input.sources } : {}),
    ...(derivedFrom ? { derived_from: derivedFrom } : {}),
    provenance: {
      method: "self-reported",
      submitted_by: issueAuthorLogin,
      reviewed_by: null,
      date,
    },
  });

  writeFileSync(
    resolve(MAPS_DIR, input.mapId, "data-quality.json"),
    `${JSON.stringify(answersFile, null, 2)}\n`,
  );

  // If the map was previously scored, reset the manifest to the Unscored
  // marker so the branch stays CI-consistent; the reviewer re-stamps via
  // rescore_data before merge. Pre-migration publish branches carry no
  // data_quality block at all — stamp the marker there too, or the manifest
  // would fail --require-presence on main after the publish PR merges.
  const existingBlock = manifest.data_quality as { tier?: string } | undefined;
  let manifestReset = false;
  let markerStamped = false;
  if (existingBlock === undefined) {
    manifest.data_quality = { tier: "unknown", rubric_version: RUBRIC_VERSION };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    markerStamped = true;
  } else if (existingBlock.tier !== "unknown") {
    manifest.data_quality = { tier: "unknown", rubric_version: RUBRIC_VERSION };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    manifestReset = true;
  }

  const verifyErrors = checkMapDataQuality({
    id: input.mapId,
    manifestDataQuality: manifest.data_quality,
    answersFile,
  });
  if (verifyErrors.length > 0) fail(verifyErrors);

  const report = buildProvisionalReport([
    { path: `maps/${input.mapId}/data-quality.json`, file: answersFile },
  ]);
  const extras: string[] = [];
  if (derivedFrom) {
    extras.push(
      `Answers inherited from **${derivedFrom}** (same-methodology). Sample considered: ${sampleIds
        .map((id) => `\`${id}\``)
        .join(", ")}.`,
    );
  }
  if (manifestReset) {
    extras.push(
      "This map was previously scored; its manifest is reset to `unknown` on this branch until a reviewer re-confirms with `rescore_data`.",
    );
  }
  if (markerStamped) {
    extras.push(
      "The manifest predates the data-quality system; the `unknown` marker was stamped alongside the answers.",
    );
  }
  writeFileSync(
    REPORT_PATH,
    `${report}\n${extras.length > 0 ? `\n${extras.join("\n\n")}\n` : ""}`,
  );
  console.log(`Validated data-quality answers for ${input.mapId}`);
}

main();
