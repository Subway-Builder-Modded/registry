import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonFile } from "../lib/json-utils.js";
import {
  applyDataQualityAnswers,
  buildCountryFloorContext,
  type CountryFloorPeer,
  type ScoredDataQualityBlock,
} from "../lib/data-quality-apply.js";
import { checkMapDataQuality } from "../lib/data-quality-check.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const MAPS_DIR = resolve(REPO_ROOT, "maps");

interface CliArgs {
  ids: string[];
  reviewer: string | null;
  date: string;
}

function parseArgs(argv: string[]): CliArgs {
  const ids: string[] = [];
  let reviewer: string | null = null;
  let date = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reviewer") {
      reviewer = argv[++i] ?? null;
    } else if (arg === "--date") {
      date = argv[++i] ?? date;
    } else if (!arg.startsWith("--")) {
      ids.push(arg);
    }
  }
  return { ids, reviewer, date };
}

/** Same-country maps with a scored (non-unknown) manifest block, self excluded. */
function collectCountryPeers(id: string, country: string): CountryFloorPeer[] {
  if (!country) return [];
  const peers: CountryFloorPeer[] = [];
  for (const entry of readdirSync(MAPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === id) continue;
    const manifestPath = resolve(MAPS_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
      if (manifest.country !== country) continue;
      const block = manifest.data_quality as
        | Partial<ScoredDataQualityBlock>
        | undefined;
      if (
        !block ||
        block.tier === undefined ||
        block.tier === ("unknown" as string) ||
        typeof block.weighted_score !== "number"
      ) {
        continue;
      }
      peers.push({
        id: entry.name,
        tier: block.tier,
        weightedScore: block.weighted_score,
      });
    } catch {
      // Unreadable manifests never block a confirmation; skip.
    }
  }
  return peers;
}

function main(): void {
  const { ids, reviewer, date } = parseArgs(process.argv.slice(2));
  if (ids.length === 0) {
    console.error(
      "Usage: apply-data-quality --reviewer <github-login> [--date YYYY-MM-DD] <map-id> [...]",
    );
    process.exit(1);
  }
  if (!reviewer) {
    console.error("--reviewer <github-login> is required");
    process.exit(1);
  }

  const failures: string[] = [];
  for (const id of ids) {
    try {
      const answersPath = resolve(MAPS_DIR, id, "data-quality.json");
      const manifestPath = resolve(MAPS_DIR, id, "manifest.json");
      if (!existsSync(answersPath)) {
        throw new Error(`maps/${id}/data-quality.json not found`);
      }
      if (!existsSync(manifestPath)) {
        throw new Error(`maps/${id}/manifest.json not found`);
      }

      const result = applyDataQualityAnswers(
        id,
        readJsonFile<unknown>(answersPath),
        { reviewer, date },
      );

      const manifest = readJsonFile<Record<string, unknown>>(manifestPath);
      manifest.data_quality = result.manifestBlock;
      writeFileSync(answersPath, `${JSON.stringify(result.answersFile, null, 2)}\n`);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const verifyErrors = checkMapDataQuality({
        id,
        manifestDataQuality: manifest.data_quality,
        answersFile: result.answersFile,
      });
      if (verifyErrors.length > 0) {
        throw new Error(`post-apply verification failed: ${verifyErrors.join("; ")}`);
      }

      const block = result.manifestBlock;
      const flipped = result.provenanceFlipped
        ? ` (confirmed by ${reviewer})`
        : ` (already ${result.answersFile.provenance.method})`;
      console.log(
        `${id}: ${block.tier} (raw ${block.raw_score}, weighted ${block.weighted_score})${flipped}`,
      );
      const country = String(manifest.country ?? "");
      const context = buildCountryFloorContext(
        { id, country, tier: block.tier },
        collectCountryPeers(id, country),
      );
      for (const line of context.lines) console.log(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      console.error(`ERROR: ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${ids.length} map(s) failed; no partial map was left inconsistent (each map is applied atomically).`);
    process.exit(1);
  }
}

main();
