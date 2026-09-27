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

const H3_LINE = /^###(?!#)[ \t]*(.*?)[ \t]*$/;

/**
 * Extracts the field labels from an issue-template YAML by scanning `label:`
 * lines. Deliberately regex-based so the sanitizer stays dependency-free; the
 * registry's templates only use plain single-line string labels.
 */
export function extractTemplateLabels(templateYaml: string): Set<string> {
  const labels = new Set<string>();
  for (const match of templateYaml.matchAll(/^[ \t]*["']?label["']?:[ \t]*(.+?)[ \t]*$/gm)) {
    let label = match[1];
    if (
      (label.startsWith('"') && label.endsWith('"') && label.length >= 2) ||
      (label.startsWith("'") && label.endsWith("'") && label.length >= 2)
    ) {
      label = label.slice(1, -1);
    }
    if (label.length > 0) labels.add(label);
  }
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
