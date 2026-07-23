import {
  DataQualityAnswersFileSchema,
  ManifestDataQualitySchema,
  RUBRIC_VERSION,
  type DataQualityAnswers,
  type DataQualityAnswersFile,
  type ManifestDataQuality,
  type OdMetric,
} from "@subway-builder-modded/registry-schemas";
import {
  computeScores,
  roundScore,
  type ComputedDataQualityScores,
} from "./data-quality.js";

/**
 * O/D rungs whose score is multiplied by a granularity G. The remaining rungs
 * (synthetic / prior / none) carry no measured grain and od_granularity stays
 * null for them.
 */
export const GRAIN_CARRYING_OD_METRICS: readonly OdMetric[] = [
  "full_matrix",
  "structured_marginals",
  "marginal_od",
];

/**
 * Grain assumed for PROVISIONAL scoring when a grain-carrying O/D metric was
 * answered without a grain (the form's Q8 left blank). ADM3 is the modal
 * real-world O/D grain; the assumption is flagged for reviewer confirmation
 * and never accepted in a confirmed (reviewed/backfill) answers file.
 */
export const PROVISIONAL_OD_GRANULARITY = "adm3" as const;

export interface MapDataQualityInput {
  /** Map id (the maps/<id> directory name). */
  id: string;
  /** Raw `data_quality` field from manifest.json; undefined when absent. */
  manifestDataQuality?: unknown;
  /** Raw parsed content of maps/<id>/data-quality.json; undefined when absent. */
  answersFile?: unknown;
}

export interface CheckOptions {
  /**
   * Post-backfill invariant (plan D5): every map manifest must carry a
   * data_quality block. Off until the backfill lands.
   */
  requirePresence?: boolean;
}

function formatZodError(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`)
    .join("; ");
}

/**
 * Validates one map's data-quality state: schema shape of both the manifest
 * block and the answers file, the reviewer gate, and score consistency
 * (manifest tier/scores must recompute exactly from the answers).
 * source_quality is deliberately NOT checked — it is decoupled and write-once.
 */
export function checkMapDataQuality(
  input: MapDataQualityInput,
  options: CheckOptions = {},
): string[] {
  const errors: string[] = [];
  const label = `maps/${input.id}`;

  let manifestBlock: ManifestDataQuality | undefined;
  if (input.manifestDataQuality !== undefined) {
    const parsed = ManifestDataQualitySchema.safeParse(input.manifestDataQuality);
    if (parsed.success) {
      manifestBlock = parsed.data;
    } else {
      errors.push(
        `${label}: manifest data_quality is invalid: ${formatZodError(parsed.error)}`,
      );
      return errors;
    }
  }

  let answers: DataQualityAnswersFile | undefined;
  if (input.answersFile !== undefined) {
    const parsed = DataQualityAnswersFileSchema.safeParse(input.answersFile);
    if (parsed.success) {
      answers = parsed.data;
      if (answers.id !== input.id) {
        errors.push(
          `${label}: data-quality.json id "${answers.id}" does not match the map directory`,
        );
      }
    } else {
      errors.push(
        `${label}: data-quality.json is invalid: ${formatZodError(parsed.error)}`,
      );
      return errors;
    }
  }

  const method = answers?.provenance.method;
  const confirmed = method === "reviewed" || method === "backfill";

  if (manifestBlock === undefined) {
    if (options.requirePresence) {
      errors.push(
        `${label}: manifest has no data_quality block (presence is required post-backfill)`,
      );
    }
    if (confirmed) {
      errors.push(
        `${label}: data-quality.json is "${method}" but the manifest has no data_quality block — stamp the manifest in the same change`,
      );
    }
    return errors;
  }

  if (manifestBlock.tier === "unknown") {
    if (confirmed) {
      errors.push(
        `${label}: data-quality.json is "${method}" but the manifest still carries the unknown marker — stamp the scored block in the same change`,
      );
    }
    return errors;
  }

  // Scored manifest block.
  if (answers === undefined) {
    errors.push(
      `${label}: scored manifest data_quality requires maps/${input.id}/data-quality.json`,
    );
    return errors;
  }
  if (!confirmed) {
    errors.push(
      `${label}: scored manifest data_quality requires reviewed/backfill answers; found "${method}"`,
    );
    return errors;
  }
  if (manifestBlock.rubric_version !== RUBRIC_VERSION) {
    errors.push(
      `${label}: manifest rubric_version ${manifestBlock.rubric_version} does not match the current rubric (${RUBRIC_VERSION}) — re-run the scorer`,
    );
    return errors;
  }
  if (
    answers.answers.od_granularity === null &&
    GRAIN_CARRYING_OD_METRICS.includes(answers.answers.od_metric)
  ) {
    errors.push(
      `${label}: confirmed answers use grain-carrying O/D metric "${answers.answers.od_metric}" but od_granularity is null — the reviewer must set the grain`,
    );
    return errors;
  }

  const scores = computeScores(answers.answers);
  if (scores.tier !== manifestBlock.tier) {
    errors.push(
      `${label}: manifest tier "${manifestBlock.tier}" does not match recomputed tier "${scores.tier}"`,
    );
  }
  if (
    manifestBlock.raw_score !== undefined &&
    manifestBlock.raw_score !== roundScore(scores.raw_score)
  ) {
    errors.push(
      `${label}: manifest raw_score ${manifestBlock.raw_score} does not match recomputed ${roundScore(scores.raw_score)}`,
    );
  }
  if (
    manifestBlock.weighted_score !== undefined &&
    manifestBlock.weighted_score !== roundScore(scores.weighted_score)
  ) {
    errors.push(
      `${label}: manifest weighted_score ${manifestBlock.weighted_score} does not match recomputed ${roundScore(scores.weighted_score)}`,
    );
  }
  return errors;
}

export interface ProvisionalScores extends ComputedDataQualityScores {
  /** True when the ADM3 O/D-grain assumption was applied (blank form Q8). */
  assumedOdGranularity: boolean;
}

/**
 * Scores for the PR/issue comment: like computeScores, but a grain-carrying
 * O/D metric with a null grain is provisionally scored at ADM3 and flagged.
 */
export function computeProvisionalScores(answers: DataQualityAnswers): ProvisionalScores {
  const assume =
    answers.od_granularity === null &&
    GRAIN_CARRYING_OD_METRICS.includes(answers.od_metric);
  const effective = assume
    ? { ...answers, od_granularity: PROVISIONAL_OD_GRANULARITY }
    : answers;
  return { ...computeScores(effective), assumedOdGranularity: assume };
}

export const DATA_QUALITY_REPORT_MARKER = "<!-- data-quality-report -->";

export interface ReportEntry {
  path: string;
  /** Parse error when the file is invalid; the report shows it instead of scores. */
  error?: string;
  file?: DataQualityAnswersFile;
}

/** Builds the markdown body for the provisional-score PR comment. */
export function buildProvisionalReport(entries: ReportEntry[]): string {
  const lines: string[] = [
    DATA_QUALITY_REPORT_MARKER,
    "## Data quality — provisional scores",
    "",
    "Recomputed from the changed `data-quality.json` files in this PR. Scores are",
    "a pure function of the answers; the manifest tier is written only once a",
    "reviewer confirms (provenance `reviewed`).",
    "",
  ];
  for (const entry of entries) {
    lines.push(`### \`${entry.path}\``, "");
    if (entry.error !== undefined || entry.file === undefined) {
      lines.push(`❌ Invalid: ${entry.error ?? "unreadable file"}`, "");
      continue;
    }
    const { file } = entry;
    const scores = computeProvisionalScores(file.answers);
    const status =
      file.provenance.method === "self-reported"
        ? "self-reported — pending reviewer confirmation"
        : `${file.provenance.method} (reviewed_by: ${file.provenance.reviewed_by ?? "—"})`;
    lines.push(
      `Provenance: **${status}**`,
      "",
      "| | Workplace | Resident | O/D | Composite |",
      "| :-- | :-- | :-- | :-- | :-- |",
      `| Raw | ${roundScore(scores.pillars.workplace.raw)} | ${roundScore(scores.pillars.resident.raw)} | ${roundScore(scores.pillars.od.raw)} | **${roundScore(scores.raw_score)}** |`,
      `| Weighted | ${roundScore(scores.pillars.workplace.weighted)} | ${roundScore(scores.pillars.resident.weighted)} | ${roundScore(scores.pillars.od.weighted)} | **${roundScore(scores.weighted_score)}** |`,
      "",
      `Tier: **${scores.tier}**`,
      "",
    );
    if (scores.assumedOdGranularity) {
      lines.push(
        `> ⚠️ O/D grain was left blank for a grain-carrying metric; provisionally assumed **${PROVISIONAL_OD_GRANULARITY}**. Reviewer must set the true grain before confirmation.`,
        "",
      );
    }
  }
  return lines.join("\n");
}
