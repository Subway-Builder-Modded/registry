import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractTemplateLabels, sanitizeIssueBody } from "../lib/issue-body-sanitizer.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

const templatePath = process.env.TEMPLATE_PATH;
if (!templatePath) {
  console.error("TEMPLATE_PATH environment variable is required");
  process.exit(1);
}

const rawBody = process.env.RAW_BODY ?? "";

const templateYaml = readFileSync(resolve(REPO_ROOT, templatePath), "utf-8");
const labels = extractTemplateLabels(templateYaml);
if (labels.size === 0) {
  console.error(`No field labels found in template: ${templatePath}`);
  process.exit(1);
}

const { body, demoted } = sanitizeIssueBody(rawBody, labels);

if (demoted.length === 0) {
  console.log("Issue body is clean — no stray h3 headings.");
} else {
  console.log(
    `Demoted ${demoted.length} stray h3 heading(s) inside field values (would have truncated the containing field):`,
  );
  for (const title of demoted) console.log(`  ### ${title}  ->  #### ${title}`);
}

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  let delimiter = "SANITIZED_ISSUE_BODY_EOF";
  while (body.includes(delimiter)) delimiter += "_X";
  appendFileSync(outputPath, `body<<${delimiter}\n${body}\n${delimiter}\n`);
} else {
  process.stdout.write(body);
}
