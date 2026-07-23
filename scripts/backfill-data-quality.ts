import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUBRIC_VERSION } from "@subway-builder-modded/registry-schemas";
import { readJsonFile } from "./lib/json-utils.js";
import {
  PIPELINE_ENCODINGS,
  findPipelineEncoding,
  recomputeEncoding,
  type PipelineEncoding,
} from "./lib/data-quality-backfill.js";
import { checkMapDataQuality } from "./lib/data-quality-check.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const MAPS_DIR = resolve(REPO_ROOT, "maps");

interface MapEntry {
  id: string;
  manifest: Record<string, unknown>;
}

function listMaps(): MapEntry[] {
  return readdirSync(MAPS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(MAPS_DIR, entry.name, "manifest.json")),
    )
    .map((entry) => ({
      id: entry.name,
      manifest: readJsonFile<Record<string, unknown>>(
        resolve(MAPS_DIR, entry.name, "manifest.json"),
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function writeManifest(id: string, manifest: Record<string, unknown>): void {
  writeFileSync(
    resolve(MAPS_DIR, id, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const includeUnconfirmed = args.includes("--include-unconfirmed");
  const reviewerIndex = args.indexOf("--reviewer");
  const reviewer = reviewerIndex !== -1 ? args[reviewerIndex + 1] : "ahkimn";
  const date = new Date().toISOString().slice(0, 10);

  const maps = listMaps();
  const matched = new Map<PipelineEncoding, MapEntry[]>();
  const skippedScored: string[] = [];
  const skippedTest: string[] = [];
  const unmatched = new Map<string, string[]>();

  for (const entry of maps) {
    const { manifest } = entry;
    const existing = manifest.data_quality as { tier?: string } | undefined;
    if (existing !== undefined && existing.tier !== "unknown") {
      skippedScored.push(entry.id);
      continue;
    }
    if (manifest.is_test === true) {
      skippedTest.push(entry.id);
      continue;
    }
    const encoding = findPipelineEncoding(
      String(manifest.country ?? ""),
      String(manifest.author ?? ""),
    );
    if (encoding && (encoding.confirmed || includeUnconfirmed)) {
      const group = matched.get(encoding) ?? [];
      group.push(entry);
      matched.set(encoding, group);
    } else {
      const key = `${manifest.country} / ${manifest.author}${encoding ? " (encoding unconfirmed)" : ""}`;
      const group = unmatched.get(key) ?? [];
      group.push(entry.id);
      unmatched.set(key, group);
    }
  }

  console.log(`Mode: ${write ? "WRITE" : "dry-run"} (unconfirmed encodings ${includeUnconfirmed ? "INCLUDED" : "excluded"})\n`);
  console.log("=== Pipeline matches ===");
  for (const encoding of PIPELINE_ENCODINGS) {
    const entries = matched.get(encoding) ?? [];
    const recomputed = recomputeEncoding(encoding);
    const delta =
      recomputed.rawDelta === 0 && recomputed.weightedDelta === 0
        ? "matches doc"
        : `doc delta raw ${recomputed.rawDelta >= 0 ? "+" : ""}${recomputed.rawDelta} / weighted ${recomputed.weightedDelta >= 0 ? "+" : ""}${recomputed.weightedDelta}`;
    console.log(
      `${encoding.country} / ${encoding.registryAuthor} (${encoding.docAuthor})${encoding.confirmed ? "" : " [UNCONFIRMED]"}: ` +
        `${entries.length} maps → ${recomputed.tier} (raw ${recomputed.raw}, weighted ${recomputed.weighted}; ${delta})`,
    );
  }

  console.log("\n=== Unmatched (will receive the unknown marker) ===");
  for (const [key, ids] of [...unmatched.entries()].sort()) {
    console.log(`${key}: ${ids.length} maps`);
  }
  if (skippedTest.length > 0) {
    console.log(`\nTest maps (unknown marker only): ${skippedTest.join(", ")}`);
  }
  if (skippedScored.length > 0) {
    console.log(`Already scored (untouched): ${skippedScored.join(", ")}`);
  }

  if (!write) {
    console.log("\nDry-run complete; pass --write to apply.");
    return;
  }

  let scoredCount = 0;
  let markerCount = 0;
  const verifyErrors: string[] = [];

  for (const [encoding, entries] of matched.entries()) {
    const recomputed = recomputeEncoding(encoding);
    for (const entry of entries) {
      const answersFile = {
        schema_version: 1,
        id: entry.id,
        answers: encoding.answers,
        notes: encoding.notes,
        provenance: {
          method: "backfill",
          submitted_by: encoding.registryAuthor,
          reviewed_by: reviewer,
          date,
        },
      };
      writeFileSync(
        resolve(MAPS_DIR, entry.id, "data-quality.json"),
        `${JSON.stringify(answersFile, null, 2)}\n`,
      );
      entry.manifest.data_quality = {
        tier: recomputed.tier,
        raw_score: recomputed.raw,
        weighted_score: recomputed.weighted,
        rubric_version: RUBRIC_VERSION,
        provenance: "backfill",
      };
      writeManifest(entry.id, entry.manifest);
      verifyErrors.push(
        ...checkMapDataQuality({
          id: entry.id,
          manifestDataQuality: entry.manifest.data_quality,
          answersFile,
        }),
      );
      scoredCount += 1;
    }
  }

  const needsMarker = [
    ...[...unmatched.values()].flat(),
    ...skippedTest,
  ];
  for (const id of needsMarker) {
    const entry = maps.find((m) => m.id === id);
    if (!entry || entry.manifest.data_quality !== undefined) continue;
    entry.manifest.data_quality = { tier: "unknown", rubric_version: RUBRIC_VERSION };
    writeManifest(id, entry.manifest);
    markerCount += 1;
  }

  if (verifyErrors.length > 0) {
    for (const error of verifyErrors) console.error(`VERIFY ERROR: ${error}`);
    process.exit(1);
  }
  console.log(
    `\nWrote ${scoredCount} scored backfills and ${markerCount} unknown markers. ` +
      "Run 'pnpm --dir scripts check-data-quality --require-presence' to verify the full invariant.",
  );
}

main();
