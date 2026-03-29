import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { loadSecurityRules, scanZipForSecurityIssues } from "../lib/mod-security.js";

function withTempRepo(run: (repoRoot: string) => Promise<void> | void): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-security-rules-"));
  mkdirSync(repoRoot, { recursive: true });
  const cleanup = () => rmSync(repoRoot, { recursive: true, force: true });
  return Promise.resolve()
    .then(() => run(repoRoot))
    .finally(cleanup);
}

function writeRules(repoRoot: string, rules: unknown): void {
  writeFileSync(
    join(repoRoot, "security-rules.json"),
    `${JSON.stringify(rules, null, 2)}\n`,
    "utf-8",
  );
}

async function makeZip(entries: Record<string, string>): Promise<JSZip> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return JSZip.loadAsync(buffer);
}

test("loadSecurityRules parses valid JSON and ignores disabled rules", async () => {
  await withTempRepo((repoRoot) => {
    writeRules(repoRoot, {
      schema_version: 1,
      rules: [
        {
          id: "enabled-rule",
          severity: "ERROR",
          type: "literal",
          pattern: "deleteSaveFile",
        },
        {
          id: "disabled-rule",
          severity: "ERROR",
          type: "literal",
          pattern: "customSavesDirectory",
          enabled: false,
        },
      ],
    });
    const loaded = loadSecurityRules(repoRoot);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.rules.length, 2);
    assert.equal(loaded.rules.find((rule) => rule.id === "disabled-rule")?.enabled, false);
    assert.ok(loaded.fingerprint.startsWith("security-rules:"));
  });
});

test("loadSecurityRules fails fast on malformed schema", async () => {
  await withTempRepo((repoRoot) => {
    writeRules(repoRoot, {
      schema_version: 1,
      rules: [
        {
          id: "bad-rule",
          severity: "SEVERE",
          type: "literal",
          pattern: "deleteSaveFile",
        },
      ],
    });
    assert.throws(
      () => loadSecurityRules(repoRoot),
      /Invalid security rules file/,
    );
  });
});

test("scanZipForSecurityIssues matches literals and regex rules", async () => {
  const zip = await makeZip({
    "index.js": "const a = deleteSaveFile;",
    "main.ts": "const b = eval(atob('Zm9v'));",
  });
  const rules = [
    {
      id: "forbidden-delete",
      severity: "ERROR" as const,
      type: "literal" as const,
      pattern: "deleteSaveFile",
      enabled: true,
    },
    {
      id: "suspicious-eval-atob",
      severity: "WARNING" as const,
      type: "regex" as const,
      pattern: "eval\\s*\\(\\s*atob\\s*\\(",
      enabled: true,
      compiledPattern: new RegExp("eval\\s*\\(\\s*atob\\s*\\("),
    },
  ];
  const issue = await scanZipForSecurityIssues(zip, rules);
  assert.ok(issue);
  assert.equal(issue?.findings.length, 2);
  assert.equal(issue?.findings[0]?.severity, "ERROR");
  assert.equal(issue?.findings[1]?.severity, "WARNING");
});

test("scanZipForSecurityIssues matches AST call-arg-call pattern", async () => {
  const zip = await makeZip({
    "main.ts": "const b = eval(atob('Zm9v'));",
  });
  const rules = [
    {
      id: "suspicious-eval-atob",
      severity: "WARNING" as const,
      type: "ast" as const,
      pattern: {
        kind: "call-arg-call" as const,
        callee: "eval",
        first_arg_callee: "atob",
      },
      enabled: true,
    },
  ];
  const issue = await scanZipForSecurityIssues(zip, rules);
  assert.ok(issue);
  assert.equal(issue?.findings.length, 1);
  assert.equal(issue?.findings[0]?.rule_id, "suspicious-eval-atob");
  assert.equal(issue?.findings[0]?.type, "ast");
});

test("scanZipForSecurityIssues matches while-loop folder-open calls via aliases", async () => {
  const zip = await makeZip({
    "index.js": "const opener = openModsFolder; while (true) { opener(); break; }",
  });
  const rules = [
    {
      id: "warning-open-folder-call-in-while",
      severity: "WARNING" as const,
      type: "ast" as const,
      pattern: {
        kind: "call-in-while" as const,
        callees: ["openModsFolder", "openSavesFolder"],
        allow_aliases: true,
      },
      enabled: true,
    },
  ];
  const issue = await scanZipForSecurityIssues(zip, rules);
  assert.ok(issue);
  assert.equal(issue?.findings.length, 1);
  assert.equal(issue?.findings[0]?.rule_id, "warning-open-folder-call-in-while");
});
