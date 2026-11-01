/**
 * Issue-form body sanitizer.
 *
 * GitHub issue forms render each field as an `### <label>` heading, and the
 * downstream parser (stefanbuck/github-issue-parser) treats EVERY h3 line as a
 * field boundary. An `### ...` line inside a free-text field value therefore
 * truncates that field and silently drops everything up to the next known
 * heading (see daegu-4, #11151: `### TAE · v0.3.1` inside the description
 * reduced it to `# Daegu`).
 *
 * The fix is lossless: before parsing, demote any h3 line whose title is NOT
 * one of the template's field labels to an h4 (`#### ...`). Known field
 * headings are left untouched, so parsing is unchanged for well-formed bodies.
 */

import YAML from "yaml";

const H3_LINE = /^###(?!#)[ \t]*(.*?)[ \t]*$/;

function collectFieldLabels(node: unknown, labels: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFieldLabels(item, labels);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const attributes = (node as Record<string, unknown>).attributes;
  if (attributes !== null && typeof attributes === "object") {
    const label = (attributes as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim() !== "") labels.add(label.trim());
  }
  for (const value of Object.values(node)) collectFieldLabels(value, labels);
}

/**
 * Extracts the field labels (`attributes.label`, the text GitHub renders as each
 * field's `### ` heading) from an issue-template YAML. Parsed as YAML, not
 * scanned line by line: the generated templates fold long double-quoted labels
 * across lines (generate-map-templates.ts, lineWidth 92), and a missed label
 * demotes a real field heading and merges its answer into the previous field.
 */
export function extractTemplateLabels(templateYaml: string): Set<string> {
  const labels = new Set<string>();
  collectFieldLabels(YAML.parse(templateYaml), labels);
  return labels;
}

export interface SanitizedIssueBody {
  body: string;
  /** Titles of the h3 lines that were demoted to h4. */
  demoted: string[];
}

/**
 * Demotes every `### <title>` line whose title is not a known field label to
 * `#### <title>`. Exact-label headings (the real field boundaries) and all
 * other content pass through byte-identical.
 */
export function sanitizeIssueBody(
  body: string,
  labels: ReadonlySet<string>,
): SanitizedIssueBody {
  const demoted: string[] = [];
  const lines = body.split("\n").map((line) => {
    const match = line.match(H3_LINE);
    if (!match || labels.has(match[1])) return line;
    demoted.push(match[1]);
    return `#${line}`;
  });
  return { body: lines.join("\n"), demoted };
}
