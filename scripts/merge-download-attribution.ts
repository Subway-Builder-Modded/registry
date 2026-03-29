import { basename, resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  readDownloadAttributionDeltaFile,
  writeDownloadAttributionLedger,
} from "./lib/download-attribution.js";

const FALLBACK_REPO_ROOT = basename(import.meta.dirname) === "dist"
  ? resolve(import.meta.dirname, "..", "..")
  : resolve(import.meta.dirname, "..");

interface CliArgs {
  repoRoot: string;
  deltaPaths: string[];
}

function parseCliArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? FALLBACK_REPO_ROOT;
  const deltaPaths: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--delta") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value after --delta");
      }
      deltaPaths.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--delta=")) {
      const value = arg.slice("--delta=".length).trim();
      if (value === "") {
        throw new Error(`Missing value in argument '${arg}'`);
      }
      deltaPaths.push(value);
      continue;
    }
    throw new Error(`Unknown argument '${arg}'. Supported: --delta <path>`);
  }

  if (deltaPaths.length === 0) {
    deltaPaths.push(
      resolve(repoRoot, "maps", "download-attribution-delta.json"),
      resolve(repoRoot, "mods", "download-attribution-delta.json"),
      resolve(repoRoot, "maps", "demand-attribution-delta.json"),
    );
  }

  return {
    repoRoot,
    deltaPaths,
  };
}

async function run(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const deltas = cli.deltaPaths
    .map((path) => ({ path, delta: readDownloadAttributionDeltaFile(path) }))
    .filter((entry) => entry.delta !== null);

  const ledger = loadDownloadAttributionLedger(cli.repoRoot);
  const merge = mergeDownloadAttributionDeltas(
    ledger,
    deltas.map((entry) => entry.delta!),
  );
  writeDownloadAttributionLedger(cli.repoRoot, merge.ledger);

  console.log(
    `[download-attribution] merged delta files=${deltas.length}, appliedDeltas=${merge.appliedDeltaIds.length}, skippedDeltas=${merge.skippedDeltaIds.length}, addedFetches=${merge.addedFetches}, assetKeysUpdated=${merge.assetKeysUpdated}`,
  );

  if (process.env.GITHUB_OUTPUT) {
    const lines = [
      `registry_fetches_added_total=${merge.addedFetches}`,
      `applied_delta_count=${merge.appliedDeltaIds.length}`,
      `skipped_delta_count=${merge.skippedDeltaIds.length}`,
      `asset_keys_updated=${merge.assetKeysUpdated}`,
    ];
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
