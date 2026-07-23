import {
  GRANULARITY_LADDER,
  OD_METRIC_LADDER,
  RESIDENT_COUNT_LADDER,
  RESIDENT_PLACEMENT_FORM_OPTIONS,
  WORKPLACE_COUNT_LADDER,
  WORKPLACE_PLACEMENT_FORM_OPTIONS,
  type DataQualityAnswers,
  type DataQualityAnswersFile,
  type DataQualityLadderRung,
  type PlacementFormOption,
} from "@subway-builder-modded/registry-schemas";
import { GRAIN_CARRYING_OD_METRICS } from "./data-quality-check.js";
import { isPresentIssueValue } from "./map-field-utils.js";

// Reverse maps: issue-form option label -> canonical enum value. Labels come
// from the same ladders module that generates the form, so they cannot drift.

function labelToValue<V extends string>(
  ladder: readonly DataQualityLadderRung<V>[],
): Map<string, V> {
  const map = new Map<string, V>();
  for (const rung of ladder) {
    if (rung.formLabel !== null) map.set(rung.formLabel, rung.value);
  }
  return map;
}

function labelToPlacement(
  options: readonly PlacementFormOption[],
): Map<string, PlacementFormOption> {
  return new Map(options.map((option) => [option.formLabel, option]));
}

const WORKPLACE_COUNT_BY_LABEL = labelToValue(WORKPLACE_COUNT_LADDER);
const RESIDENT_COUNT_BY_LABEL = labelToValue(RESIDENT_COUNT_LADDER);
const GRANULARITY_BY_LABEL = labelToValue(GRANULARITY_LADDER);
const OD_METRIC_BY_LABEL = labelToValue(OD_METRIC_LADDER);
const WORKPLACE_PLACEMENT_BY_LABEL = labelToPlacement(WORKPLACE_PLACEMENT_FORM_OPTIONS);
const RESIDENT_PLACEMENT_BY_LABEL = labelToPlacement(RESIDENT_PLACEMENT_FORM_OPTIONS);

export const SAME_METHODOLOGY_YES_PREFIX = "Yes";

export interface DataQualityIssueInput {
  mapId: string;
  sameMethodology: boolean;
  answers: DataQualityAnswers | null;
  methodology: string;
  sources: string[];
}

export interface ParseIssueResult {
  input?: DataQualityIssueInput;
  errors: string[];
}

function readField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return isPresentIssueValue(value) && typeof value === "string"
    ? value.trim()
    : undefined;
}

function mapLabel<V extends string>(
  errors: string[],
  field: string,
  label: string | undefined,
  byLabel: Map<string, V>,
  required: boolean,
): V | undefined {
  if (label === undefined) {
    if (required) errors.push(`**${field}**: An answer is required (or answer Yes to same-methodology).`);
    return undefined;
  }
  const value = byLabel.get(label);
  if (value === undefined) {
    errors.push(`**${field}**: Unrecognized option "${label}" — re-select from the dropdown.`);
    return undefined;
  }
  return value;
}

/** Parses the data-quality issue form into either an inheritance request or a full answers block. */
export function parseDataQualityIssue(data: Record<string, unknown>): ParseIssueResult {
  const errors: string[] = [];
  const mapId = readField(data, "map-id")?.toLowerCase();
  if (!mapId || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(mapId)) {
    errors.push("**map-id**: A valid kebab-case map id is required.");
    return { errors };
  }

  const methodology = readField(data, "methodology");
  if (!methodology) {
    errors.push("**methodology**: A methodology description is required.");
  }
  const sources = (readField(data, "sources") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sameMethodology = (readField(data, "same-methodology") ?? "").startsWith(
    SAME_METHODOLOGY_YES_PREFIX,
  );

  if (sameMethodology) {
    if (errors.length > 0) return { errors };
    return {
      input: { mapId, sameMethodology: true, answers: null, methodology: methodology!, sources },
      errors,
    };
  }

  const workplaceCount = mapLabel(errors, "dq-workplace-source", readField(data, "dq-workplace-source"), WORKPLACE_COUNT_BY_LABEL, true);
  const workplaceGrain = mapLabel(errors, "dq-workplace-detail", readField(data, "dq-workplace-detail"), GRANULARITY_BY_LABEL, true);
  const workplacePlacement = readField(data, "dq-workplace-placement");
  const workplacePair = workplacePlacement
    ? WORKPLACE_PLACEMENT_BY_LABEL.get(workplacePlacement)
    : undefined;
  if (!workplacePair) {
    errors.push("**dq-workplace-placement**: An answer is required (or answer Yes to same-methodology).");
  }

  const residentCount = mapLabel(errors, "dq-residence-source", readField(data, "dq-residence-source"), RESIDENT_COUNT_BY_LABEL, true);
  const residentGrain = mapLabel(errors, "dq-residence-detail", readField(data, "dq-residence-detail"), GRANULARITY_BY_LABEL, true);
  const residencePlacement = readField(data, "dq-residence-placement");
  const residentPair = residencePlacement
    ? RESIDENT_PLACEMENT_BY_LABEL.get(residencePlacement)
    : undefined;
  if (!residentPair) {
    errors.push("**dq-residence-placement**: An answer is required (or answer Yes to same-methodology).");
  }

  const odMetric = mapLabel(errors, "dq-od", readField(data, "dq-od"), OD_METRIC_BY_LABEL, true);
  const odGrain = mapLabel(errors, "dq-od-detail", readField(data, "dq-od-detail"), GRANULARITY_BY_LABEL, false);

  if (errors.length > 0) return { errors };

  const answers: DataQualityAnswers = {
    workplace_count: workplaceCount!,
    workplace_granularity: workplaceGrain!,
    workplace_resolution: workplacePair!.resolution,
    workplace_intensity: workplacePair!.intensity,
    resident_count: residentCount!,
    resident_granularity: residentGrain!,
    resident_resolution: residentPair!.resolution,
    resident_intensity: residentPair!.intensity,
    od_metric: odMetric!,
    od_granularity:
      odGrain !== undefined && GRAIN_CARRYING_OD_METRICS.includes(odMetric!)
        ? odGrain
        : null,
  };

  return {
    input: { mapId, sameMethodology: false, answers, methodology: methodology!, sources },
    errors,
  };
}

export interface InheritanceCandidate {
  id: string;
  lastUpdated: number;
  answersFile: DataQualityAnswersFile;
}

export interface InheritanceResult {
  source?: InheritanceCandidate;
  sample: InheritanceCandidate[];
  error?: string;
}

/**
 * Resolves same-methodology inheritance: the author's other same-country maps
 * with reviewed/backfill answers files, newest first (capped at five for the
 * sample). Inherits from the newest; heterogeneous answer sets are refused so
 * the author answers directly instead of silently inheriting the wrong pipeline.
 */
export function resolveInheritance(
  candidates: InheritanceCandidate[],
): InheritanceResult {
  const sorted = [...candidates].sort((a, b) => b.lastUpdated - a.lastUpdated);
  const sample = sorted.slice(0, 5);
  if (sorted.length === 0) {
    return {
      sample,
      error:
        "No scored maps by this author in the same country were found to inherit from — answer the questions directly instead.",
    };
  }
  const distinct = new Set(sorted.map((c) => JSON.stringify(c.answersFile.answers)));
  if (distinct.size > 1) {
    return {
      sample,
      error: `Your scored maps in this country carry ${distinct.size} different answer sets (${sample
        .map((c) => c.id)
        .join(", ")}) — answer the questions directly so the right pipeline is recorded.`,
    };
  }
  return { source: sorted[0], sample };
}
