import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadDownloadAttributionLedger,
  mergeDownloadAttributionDeltas,
  readDownloadAttributionDeltaFile,
  writeDownloadAttributionLedger,
} from "./lib/download-attribution.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "./lib/script-runtime.js";

interface CliArgs {
  repoRoot: string;
  deltaPaths: string[];
}

function parseCliArgs(argv: string[]): CliArgs {
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
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

  appendGitHubOutput([
    `registry_fetches_added_total=${merge.addedFetches}`,
    `applied_delta_count=${merge.appliedDeltaIds.length}`,
    `skipped_delta_count=${merge.skippedDeltaIds.length}`,
    `asset_keys_updated=${merge.assetKeysUpdated}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
