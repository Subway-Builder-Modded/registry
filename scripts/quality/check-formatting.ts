import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { spawnSync } from "node:child_process";
import {
  canonicalizeJsonText,
  decodeStrictUtf8,
  findMojibake,
  fixMojibake,
  hasUtf8Bom,
} from "../lib/formatting.js";

// Formatting invariants over tracked files. Default mode reports and exits
// non-zero on any problem; --fix rewrites what is mechanically fixable
// (BOM removal, mojibake repair, JSON canonicalization) and exits non-zero
// only if unfixable problems remain (invalid UTF-8, unparseable JSON).
//
// Checks:
// 1. Every tracked text file: valid UTF-8, no BOM, no CP-1252 mojibake
//    (see lib/formatting.ts — motivated by publish.yml shipping "â€”" in
//    user-facing bot comments for five days, KNOWN_INCIDENTS-adjacent).
// 2. Registry data JSON (maps/, mods/, authors/, analytics/, history/ and
//    root-level *.json): canonical style, i.e. byte-identical to
//    JSON.stringify(parsed, null, 2) + "\n" — exactly what writeJsonFile and
//    every generator already emit. tsconfig*.json is excluded (dev config,
//    not registry data).

const REPO_ROOT = process.env.RAILYARD_REPO_ROOT
  ? resolve(process.env.RAILYARD_REPO_ROOT)
  : resolve(import.meta.dirname, "..", "..");

const fixMode = process.argv.includes("--fix");

const TEXT_EXTENSIONS = new Set([
  ".json", ".yml", ".yaml", ".md", ".mdx", ".ts", ".tsx", ".js", ".mjs",
  ".cjs", ".csv", ".txt", ".html", ".css",
]);

const JSON_CANONICAL_DIRS = ["maps/", "mods/", "authors/", "analytics/", "history/"];

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function isCanonicalJsonTarget(path: string): boolean {
  if (!path.endsWith(".json")) return false;
  if (basename(path).startsWith("tsconfig")) return false;
  return JSON_CANONICAL_DIRS.some((dir) => path.startsWith(dir)) || !path.includes("/");
}

function listTrackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter((path) => path.length > 0);
}

interface Problem {
  path: string;
  kind: "invalid-utf8" | "bom" | "mojibake" | "json-style" | "json-parse";
  detail: string;
  fixable: boolean;
}

function main(): void {
  const problems: Problem[] = [];
  let fixedFiles = 0;

  for (const path of listTrackedFiles()) {
    if (!isTextFile(path)) continue;
    const absolute = resolve(REPO_ROOT, path);
    let buffer: Buffer;
    try {
      buffer = readFileSync(absolute);
    } catch {
      continue; // tracked but locally deleted
    }

    const bom = hasUtf8Bom(buffer);
    const content = decodeStrictUtf8(bom ? buffer.subarray(3) : buffer);
    if (content === null) {
      problems.push({ path, kind: "invalid-utf8", detail: "file is not valid UTF-8", fixable: false });
      continue;
    }
    if (bom) {
      problems.push({ path, kind: "bom", detail: "file starts with a UTF-8 BOM", fixable: true });
    }

    const mojibake = findMojibake(content);
    let fixedContent = content;
    if (mojibake.length > 0) {
      const preview = mojibake
        .slice(0, 3)
        .map((finding) => `"${finding.sequence}" -> "${finding.replacement}"`)
        .join(", ");
      problems.push({
        path,
        kind: "mojibake",
        detail: `${mojibake.length} mojibake sequence(s): ${preview}${mojibake.length > 3 ? ", ..." : ""}`,
        fixable: true,
      });
      fixedContent = fixMojibake(content).text;
    }

    if (isCanonicalJsonTarget(path)) {
      const canonical = canonicalizeJsonText(fixedContent);
      if (canonical === null) {
        problems.push({ path, kind: "json-parse", detail: "file is not parseable JSON", fixable: false });
      } else if (canonical !== fixedContent) {
        problems.push({ path, kind: "json-style", detail: "not in canonical JSON style (stringify indent-2 + trailing newline)", fixable: true });
        fixedContent = canonical;
      }
    }

    if (fixMode && (bom || fixedContent !== content)) {
      writeFileSync(absolute, fixedContent, "utf-8");
      fixedFiles += 1;
    }
  }

  for (const problem of problems) {
    const tag = fixMode && problem.fixable ? "fixed" : problem.fixable ? "fixable" : "NOT AUTO-FIXABLE";
    console.log(`[formatting] ${problem.path}: ${problem.kind} (${tag}) — ${problem.detail}`);
  }

  const unfixable = problems.filter((problem) => !problem.fixable);
  if (fixMode) {
    console.log(`[formatting] fixed ${fixedFiles} file(s); ${unfixable.length} problem(s) need manual attention`);
    process.exit(unfixable.length > 0 ? 1 : 0);
  }
  if (problems.length > 0) {
    console.log(
      `[formatting] ${problems.length} problem(s) in ${new Set(problems.map((p) => p.path)).size} file(s). ` +
      "Run `pnpm --dir scripts run fix-formatting` locally, or wait for the auto-fix commit on this PR.",
    );
    process.exit(1);
  }
  console.log("[formatting] all tracked text files clean");
}

main();
