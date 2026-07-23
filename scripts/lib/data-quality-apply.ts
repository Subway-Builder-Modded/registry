import {
  DataQualityAnswersFileSchema,
  RUBRIC_VERSION,
  type DataQualityAnswersFile,
  type ManifestDataQuality,
} from "@subway-builder-modded/registry-schemas";
import {
  computeScores,
  roundScore,
  type ComputedDataQualityScores,
} from "./data-quality.js";
import { GRAIN_CARRYING_OD_METRICS } from "./data-quality-check.js";

export interface ApplyDataQualityOptions {
  /** GitHub login of the confirming maintainer. */
  reviewer: string;
  /** ISO date (YYYY-MM-DD) of the confirmation. */
  date: string;
}

/** The scored variant of the manifest block (never the unknown marker). */
export type ScoredDataQualityBlock = Extract<
  ManifestDataQuality,
  { provenance: string }
>;

export interface ApplyDataQualityResult {
  id: string;
  /** Answers file with provenance confirmed (unchanged when already confirmed). */
  answersFile: DataQualityAnswersFile;
  /** Scored block to write into the manifest's data_quality field. */
  manifestBlock: ScoredDataQualityBlock;
  scores: ComputedDataQualityScores;
  /** True when self-reported provenance was flipped to reviewed. */
  provenanceFlipped: boolean;
}

/**
 * Confirms a map's rubric answers and derives its scored manifest block: the
 * reviewer-confirmation step of the scoring flow. Self-reported provenance is
 * flipped to reviewed (attributed to the given reviewer); reviewed/backfill
 * answers pass through unchanged. Throws with a human-readable message on any
 * state a reviewer must resolve first.
 */
export function applyDataQualityAnswers(
  id: string,
  rawAnswersFile: unknown,
  options: ApplyDataQualityOptions,
): ApplyDataQualityResult {
  const parsed = DataQualityAnswersFileSchema.safeParse(rawAnswersFile);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`)
      .join("; ");
    throw new Error(`maps/${id}/data-quality.json is invalid: ${details}`);
  }
  const file = parsed.data;
  if (file.id !== id) {
    throw new Error(
      `maps/${id}/data-quality.json declares id "${file.id}" — it must match the map directory`,
    );
  }
  if (
    file.answers.od_granularity === null &&
    GRAIN_CARRYING_OD_METRICS.includes(file.answers.od_metric)
  ) {
    throw new Error(
      `maps/${id}: O/D metric "${file.answers.od_metric}" carries a grain but od_granularity is null — set the grain before confirming`,
    );
  }

  const provenanceFlipped = file.provenance.method === "self-reported";
  const answersFile: DataQualityAnswersFile = provenanceFlipped
    ? {
        ...file,
        provenance: {
          ...file.provenance,
          method: "reviewed",
          reviewed_by: options.reviewer,
          date: options.date,
        },
      }
    : file;

  const scores = computeScores(answersFile.answers);
  const manifestBlock: ScoredDataQualityBlock = {
    tier: scores.tier,
    raw_score: roundScore(scores.raw_score),
    weighted_score: roundScore(scores.weighted_score),
    rubric_version: RUBRIC_VERSION,
    provenance:
      answersFile.provenance.method === "backfill" ? "backfill" : "reviewed",
  };

  return { id, answersFile, manifestBlock, scores, provenanceFlipped };
}
