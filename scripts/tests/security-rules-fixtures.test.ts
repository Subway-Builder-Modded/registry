import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import JSZip from "jszip";
import { loadSecurityRules, scanZipForSecurityIssues } from "../lib/mod-security.js";

const scriptsRoot = resolve(import.meta.dirname, "..", "..");
const repoRoot = resolve(scriptsRoot, "..");
const fixturesRoot = resolve(scriptsRoot, "tests", "fixtures", "security-rules");

function readRuleFixtureMap(): Record<string, string[]> {
  const ruleDirs = readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const result: Record<string, string[]> = {};
  for (const ruleId of ruleDirs) {
    const ruleDir = resolve(fixturesRoot, ruleId);
    const fixturePaths = readdirSync(ruleDir)
      .filter((fileName) => extname(fileName).toLowerCase() === ".js")
      .sort()
      .map((fileName) => resolve(ruleDir, fileName));
    result[ruleId] = fixturePaths;
  }
  return result;
}

async function makeZipForFixture(ruleId: string, fixturePath: string): Promise<JSZip> {
  const source = readFileSync(fixturePath, "utf-8");
  const zip = new JSZip();
  zip.file(`${ruleId}/${basename(fixturePath)}`, source);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return JSZip.loadAsync(buffer);
}

test("fixture set has one folder per enabled security rule with at least one .js fixture", () => {
  const enabledRuleIds = loadSecurityRules(repoRoot).rules
    .filter((rule) => rule.enabled)
    .map((rule) => rule.id)
    .sort();
  const fixtureMap = readRuleFixtureMap();
  const fixtureRuleIds = Object.keys(fixtureMap).sort();

  assert.deepEqual(
    fixtureRuleIds,
    enabledRuleIds,
    "fixtures/security-rules must contain one folder per enabled security rule",
  );

  for (const ruleId of fixtureRuleIds) {
    assert.ok(
      fixtureMap[ruleId].length > 0,
      `Rule fixture folder '${ruleId}' must contain at least one .js fixture`,
    );
  }
});

test("each fixture file in each rule folder triggers its matching enabled security rule", async () => {
  const rules = loadSecurityRules(repoRoot).rules.filter((rule) => rule.enabled);
  const fixtureMap = readRuleFixtureMap();
  for (const rule of rules) {
    const fixturePaths = fixtureMap[rule.id] ?? [];
    for (const fixturePath of fixturePaths) {
      const zip = await makeZipForFixture(rule.id, fixturePath);
      const issue = await scanZipForSecurityIssues(zip, [rule]);
      assert.ok(
        issue,
        `Fixture '${fixturePath}' produced no findings for rule '${rule.id}'`,
      );
      assert.ok(
        issue.findings.some((finding) => finding.rule_id === rule.id),
        `Fixture '${fixturePath}' did not trigger rule '${rule.id}'`,
      );
    }
  }
});

test("all fixtures combined trigger every enabled rule in security-rules.json", async () => {
  const rules = loadSecurityRules(repoRoot).rules.filter((rule) => rule.enabled);
  const fixtureMap = readRuleFixtureMap();

  const zip = new JSZip();
  for (const [ruleId, fixturePaths] of Object.entries(fixtureMap)) {
    for (const fixturePath of fixturePaths) {
      const source = readFileSync(fixturePath, "utf-8");
      zip.file(`${ruleId}/${basename(fixturePath)}`, source);
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const loadedZip = await JSZip.loadAsync(buffer);

  const issue = await scanZipForSecurityIssues(loadedZip, rules);
  assert.ok(issue, "Expected combined fixture scan to produce findings");
  const foundRuleIds = new Set(issue.findings.map((finding) => finding.rule_id));
  for (const rule of rules) {
    assert.ok(
      foundRuleIds.has(rule.id),
      `Combined fixture scan did not trigger enabled rule '${rule.id}'`,
    );
  }
});
