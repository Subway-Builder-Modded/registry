import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { extractTemplateLabels, sanitizeIssueBody } from "../lib/issue-body-sanitizer.js";

const TEMPLATE = `
name: "[Update Map]"
body:
  - type: input
    id: map-id
    attributes:
      label: Map ID
  - type: textarea
    id: description
    attributes:
      label: Description
      description: "Full listing description."
  - type: input
    id: custom-update-url
    attributes:
      label: "Custom Update URL"
`;

test("extractTemplateLabels reads quoted and unquoted labels", () => {
  const labels = extractTemplateLabels(TEMPLATE);
  assert.ok(labels.has("Map ID"));
  assert.ok(labels.has("Description"));
  assert.ok(labels.has("Custom Update URL"));
});

test("extractTemplateLabels handles generated templates with quoted keys", () => {
  const generated = '  - "type": "input"\n    "attributes":\n      "label": "Map ID"\n      "description": "The ID."\n';
  const labels = extractTemplateLabels(generated);
  assert.ok(labels.has("Map ID"));
});

test("extractTemplateLabels reads labels folded across lines", () => {
  // The shape YAML.stringify emits for a long double-quoted label (data-quality.yml).
  const folded = [
    "body:",
    '  - "type": "dropdown"',
    '    "attributes":',
    '      "label": "When a job number covers an area bigger than one building, how did you place the',
    '        jobs within it?"',
    '      "options":',
    '        - "Spread evenly across each area"',
  ].join("\n");
  const labels = extractTemplateLabels(folded);
  assert.deepEqual(
    [...labels],
    ["When a job number covers an area bigger than one building, how did you place the jobs within it?"],
  );
});

test("extractTemplateLabels ignores checkbox option labels", () => {
  const checkboxes = [
    "body:",
    "  - type: checkboxes",
    "    attributes:",
    "      label: Terms",
    "      options:",
    "        - label: I agree to the terms",
  ].join("\n");
  assert.deepEqual([...extractTemplateLabels(checkboxes)], ["Terms"]);
});

test("every repository issue-template label is recognized", () => {
  const templateDir = resolve(import.meta.dirname, "..", "..", "..", ".github", "ISSUE_TEMPLATE");
  for (const fileName of readdirSync(templateDir).filter((name) => name.endsWith(".yml") && name !== "config.yml")) {
    const yaml = readFileSync(resolve(templateDir, fileName), "utf-8");
    const expected = (YAML.parse(yaml).body as Array<{ type: string; attributes?: { label?: string } }>)
      .filter((field) => field.type !== "markdown")
      .map((field) => field.attributes!.label!.trim());
    assert.deepEqual([...extractTemplateLabels(yaml)].sort(), [...new Set(expected)].sort(), fileName);
  }
});

test("data-quality placement headings survive sanitizing (lima-callao #13755 regression)", () => {
  const templatePath = resolve(import.meta.dirname, "..", "..", "..", ".github", "ISSUE_TEMPLATE", "data-quality.yml");
  const labels = extractTemplateLabels(readFileSync(templatePath, "utf-8"));
  const body = [
    "### What is the smallest area your job numbers are reported for?",
    "",
    "Individual buildings or census blocks",
    "",
    "### When a job number covers an area bigger than one building, how did you place the jobs within it?",
    "",
    "Nothing to place — the data is already per building or block",
    "",
    "### When a population number covers an area bigger than one building, how did you place the people within it?",
    "",
    "Spread evenly across each area",
  ].join("\n");
  const { body: sanitized, demoted } = sanitizeIssueBody(body, labels);
  assert.deepEqual(demoted, []);
  assert.equal(sanitized, body);
});

test("stray h3 inside a field value is demoted to h4 (daegu-4 regression)", () => {
  const labels = new Set(["Map ID", "Description", "Custom Update URL"]);
  const body = [
    "### Map ID",
    "",
    "daegu-4",
    "",
    "### Description",
    "",
    "# Daegu",
    "",
    "### TAE · v0.3.1",
    "",
    "Custom map of Daegu, Korea.",
    "",
    "### Custom Update URL",
    "",
    "_No response_",
  ].join("\n");

  const { body: sanitized, demoted } = sanitizeIssueBody(body, labels);
  assert.deepEqual(demoted, ["TAE · v0.3.1"]);
  assert.ok(sanitized.includes("\n#### TAE · v0.3.1\n"));
  // Real field boundaries are untouched.
  assert.ok(sanitized.includes("\n### Description\n"));
  assert.ok(sanitized.includes("\n### Custom Update URL\n"));
});

test("clean bodies pass through byte-identical", () => {
  const labels = new Set(["Map ID", "Description"]);
  const body = "### Map ID\n\nseoul-4\n\n### Description\n\n# Seoul\n\n**SEL · v0.4.0**\n\n## Coverage\n\n#### Already-h4 heading\n";
  const { body: sanitized, demoted } = sanitizeIssueBody(body, labels);
  assert.equal(sanitized, body);
  assert.deepEqual(demoted, []);
});

test("h4+ headings and mid-line hashes are never touched", () => {
  const labels = new Set(["Description"]);
  const body = "### Description\n\n#### sub\n##### subsub\ntext ### not a heading\n";
  const { body: sanitized, demoted } = sanitizeIssueBody(body, labels);
  assert.equal(sanitized, body);
  assert.deepEqual(demoted, []);
});

test("bare ### line with no title is demoted", () => {
  const labels = new Set(["Description"]);
  const body = "### Description\n\n###\ntext\n";
  const { body: sanitized } = sanitizeIssueBody(body, labels);
  assert.ok(sanitized.includes("\n####\n"));
});
