import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  DEFAULT_MAP_DATA_SOURCE,
  LEVEL_OF_DETAIL_VALUES,
  LOCATION_TAGS,
  SOURCE_QUALITY_VALUES,
  SPECIAL_DEMAND_TAGS,
} from "../lib/map-constants.js";

type IssueTemplateField = {
  id?: string;
  type: string;
  attributes?: {
    options?: Array<{ label: string; required?: boolean }> | string[];
    value?: string;
    placeholder?: string;
    description?: string;
  };
  validations?: {
    required?: boolean;
  };
};

function getField(body: unknown[], id: string): IssueTemplateField {
  const field = body.find((item) => {
    if (typeof item !== "object" || item === null) return false;
    return (item as { id?: string }).id === id;
  });
  assert.ok(field, `Expected field '${id}' in template`);
  return field as IssueTemplateField;
}

function getFieldIndex(body: unknown[], id: string): number {
  const index = body.findIndex((item) => {
    if (typeof item !== "object" || item === null) return false;
    return (item as { id?: string }).id === id;
  });
  assert.notEqual(index, -1, `Expected field '${id}' in template`);
  return index;
}

function parseTemplate(templateName: "publish-map.yml" | "update-map.yml"): {
  body: unknown[];
} {
  const scriptsRoot = resolve(import.meta.dirname, "..", "..");
  const templatePath = resolve(
    scriptsRoot,
    "..",
    ".github",
    "ISSUE_TEMPLATE",
    templateName,
  );
  return YAML.parse(readFileSync(templatePath, "utf-8")) as {
    body: unknown[];
  };
}

function getDropdownOptions(field: IssueTemplateField): string[] {
  const options = field.attributes?.options;
  assert.ok(Array.isArray(options), `Expected options array for '${field.id}'`);
  return options.map((entry) => (typeof entry === "string" ? entry : entry.label));
}

test("publish-map.yml enforces required publish fields with blank dropdown defaults", () => {
  const parsed = parseTemplate("publish-map.yml");

  assert.ok(Array.isArray(parsed.body), "Template body should be an array");

  const sourceQuality = getField(parsed.body, "source_quality");
  assert.equal(sourceQuality.type, "dropdown");
  assert.deepEqual(getDropdownOptions(sourceQuality), ["", ...SOURCE_QUALITY_VALUES]);
  assert.equal(sourceQuality.validations?.required, true);

  const levelOfDetail = getField(parsed.body, "level_of_detail");
  assert.equal(levelOfDetail.type, "dropdown");
  assert.deepEqual(getDropdownOptions(levelOfDetail), ["", ...LEVEL_OF_DETAIL_VALUES]);
  assert.equal(levelOfDetail.validations?.required, true);

  const location = getField(parsed.body, "location");
  assert.equal(location.type, "dropdown");
  assert.deepEqual(getDropdownOptions(location), ["", ...LOCATION_TAGS]);
  assert.equal(location.validations?.required, true);

  const updateType = getField(parsed.body, "update-type");
  assert.equal(updateType.type, "dropdown");
  assert.deepEqual(getDropdownOptions(updateType), ["", "GitHub Releases", "Custom URL"]);
  assert.equal(updateType.validations?.required, true);

  const specialDemand = getField(parsed.body, "special_demand");
  assert.equal(specialDemand.type, "checkboxes");
  const specialDemandLabels = specialDemand.attributes?.options?.map((entry) =>
    typeof entry === "string" ? entry : entry.label
  );
  assert.deepEqual(
    specialDemandLabels,
    SPECIAL_DEMAND_TAGS,
  );

  const dataSource = getField(parsed.body, "data_source");
  assert.equal(dataSource.type, "input");
  assert.equal(dataSource.attributes?.value, DEFAULT_MAP_DATA_SOURCE);

  const methodology = getField(parsed.body, "methodology");
  assert.equal(methodology.type, "input");
  assert.equal(methodology.validations?.required, true);
  assert.ok(
    typeof methodology.attributes?.placeholder === "string"
      && methodology.attributes.placeholder.length > 0,
    "Methodology field should provide a non-empty placeholder",
  );

  const publishMapId = getField(parsed.body, "map-id");
  assert.equal(publishMapId.validations?.required, true);

  const collaboratorsIndex = getFieldIndex(parsed.body, "collaborators");
  const collaboratorsSection = parsed.body[collaboratorsIndex - 1] as {
    type?: string;
    attributes?: { value?: string };
  };
  assert.equal(collaboratorsSection.type, "markdown");
  assert.equal(collaboratorsSection.attributes?.value, "## Collaborators.");
  const collaborators = getField(parsed.body, "collaborators");
  assert.equal(collaborators.type, "input");
  assert.equal(collaborators.attributes?.description, "Optional comma-separated collaborator GitHub user IDs. Each ID must belong to an existing GitHub account.");
  assert.equal(collaborators.attributes?.placeholder, "123456789, 987654321");
  assert.equal(collaborators.validations?.required, false);
});

test("update-map.yml keeps map-id/terms required and makes other fields optional", () => {
  const parsed = parseTemplate("update-map.yml");

  assert.ok(Array.isArray(parsed.body), "Template body should be an array");

  const mapId = getField(parsed.body, "map-id");
  assert.equal(mapId.validations?.required, true);

  const optionalUpdateFields = [
    "name",
    "city-code",
    "country",
    "description",
    "source_quality",
    "level_of_detail",
    "methodology",
    "location",
    "gallery",
    "source",
    "update-type",
    "collaborators",
  ];
  for (const id of optionalUpdateFields) {
    const field = getField(parsed.body, id);
    assert.equal(
      field.validations?.required,
      false,
      `Expected '${id}' to be optional in update-map.yml`,
    );
  }

  const sourceQuality = getField(parsed.body, "source_quality");
  assert.deepEqual(getDropdownOptions(sourceQuality), ["", ...SOURCE_QUALITY_VALUES]);

  const levelOfDetail = getField(parsed.body, "level_of_detail");
  assert.deepEqual(getDropdownOptions(levelOfDetail), ["", ...LEVEL_OF_DETAIL_VALUES]);

  const location = getField(parsed.body, "location");
  assert.deepEqual(getDropdownOptions(location), ["", ...LOCATION_TAGS]);

  const updateType = getField(parsed.body, "update-type");
  assert.deepEqual(getDropdownOptions(updateType), ["", "GitHub Releases", "Custom URL"]);

  const terms = getField(parsed.body, "terms");
  assert.equal(terms.type, "checkboxes");
  const firstOption = terms.attributes?.options?.[0];
  const termsRequired = typeof firstOption === "string" ? undefined : firstOption?.required;
  assert.equal(termsRequired, true);

  const specialDemand = getField(parsed.body, "special_demand");
  assert.equal(
    (specialDemand.attributes as { description?: string } | undefined)?.description,
    "Select tags only if you want to replace current special demand tags. Leave all unchecked to keep current tags.",
  );

  const updateFieldsWithoutInheritedHints = [
    "name",
    "city-code",
    "country",
    "description",
    "data_source",
    "methodology",
    "source",
    "github-repo",
    "custom-update-url",
    "collaborators",
  ];
  for (const id of updateFieldsWithoutInheritedHints) {
    const field = getField(parsed.body, id);
    assert.equal(
      field.attributes?.placeholder,
      undefined,
      `Expected '${id}' to have no inherited placeholder in update-map.yml`,
    );
    assert.equal(
      field.attributes?.value,
      undefined,
      `Expected '${id}' to have no inherited default value in update-map.yml`,
    );
  }

  const collaboratorsIndex = getFieldIndex(parsed.body, "collaborators");
  const collaboratorsSection = parsed.body[collaboratorsIndex - 1] as {
    type?: string;
    attributes?: { value?: string };
  };
  assert.equal(collaboratorsSection.type, "markdown");
  assert.equal(collaboratorsSection.attributes?.value, "## Collaborators.");
  const collaborators = getField(parsed.body, "collaborators");
  assert.equal(
    collaborators.attributes?.description,
    "Leave blank to keep current collaborators. Enter `None` to clear. Otherwise, enter comma-separated GitHub user IDs to replace current collaborators.",
  );
});
