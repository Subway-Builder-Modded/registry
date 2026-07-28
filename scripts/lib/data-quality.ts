import {
  GRANULARITY_LADDER,
  INTENSITY_FIDELITY_LADDER,
  OD_METRIC_LADDER,
  PILLAR_WEIGHTS,
  RESIDENT_COUNT_LADDER,
  SPATIAL_RESOLUTION_LADDER,
  WORKPLACE_COUNT_LADDER,
  ladderWeight,
  tierForWeightedScore,
  type DataQualityAnswers,
  type ScoredDataQualityTier,
} from "@subway-builder-modded/registry-schemas";

// Canonical rubric answers for one map: the `answers` block of
// maps/<id>/data-quality.json, typed by DataQualityAnswersSchema in the
// schemas package. Scores are a pure function of that object.
export type { DataQualityAnswers } from "@subway-builder-modded/registry-schemas";

export interface PillarScores {
  /** Weakest-link product: count × (R × I) × G (O/D: metric × G). */
  raw: number;
  /** Half-and-half: (0.5·count + 0.5·R·I) × G (O/D has no split; same as raw). */
  weighted: number;
}

export interface ComputedDataQualityScores {
  /** Sterner internal composite in [0, 1]. */
  raw_score: number;
  /** Player-facing graded composite in [0, 1]; the tier derives from this. */
  weighted_score: number;
  tier: ScoredDataQualityTier;
  pillars: {
    workplace: PillarScores;
    resident: PillarScores;
    od: PillarScores;
  };
}

/** Rounds a score for storage/display; internal math stays unrounded. */
export function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

export function computeScores(answers: DataQualityAnswers): ComputedDataQualityScores {
  const workplaceCount = ladderWeight(WORKPLACE_COUNT_LADDER, answers.workplace_count);
  const workplaceRI =
    ladderWeight(SPATIAL_RESOLUTION_LADDER, answers.workplace_resolution) *
    ladderWeight(INTENSITY_FIDELITY_LADDER, answers.workplace_intensity);
  const workplaceG = ladderWeight(GRANULARITY_LADDER, answers.workplace_granularity);

  const residentCount = ladderWeight(RESIDENT_COUNT_LADDER, answers.resident_count);
  const residentRI =
    ladderWeight(SPATIAL_RESOLUTION_LADDER, answers.resident_resolution) *
    ladderWeight(INTENSITY_FIDELITY_LADDER, answers.resident_intensity);
  const residentG = ladderWeight(GRANULARITY_LADDER, answers.resident_granularity);

  const odMetric = ladderWeight(OD_METRIC_LADDER, answers.od_metric);
  const odG =
    answers.od_granularity === null
      ? 1
      : ladderWeight(GRANULARITY_LADDER, answers.od_granularity);
  const od = odMetric * odG;

  const workplace: PillarScores = {
    raw: workplaceCount * workplaceRI * workplaceG,
    weighted: (0.5 * workplaceCount + 0.5 * workplaceRI) * workplaceG,
  };
  const resident: PillarScores = {
    raw: residentCount * residentRI * residentG,
    weighted: (0.5 * residentCount + 0.5 * residentRI) * residentG,
  };
  const odPillar: PillarScores = { raw: od, weighted: od };

  const combine = (key: keyof PillarScores): number =>
    PILLAR_WEIGHTS.workplace * workplace[key] +
    PILLAR_WEIGHTS.resident * resident[key] +
    PILLAR_WEIGHTS.od * odPillar[key];

  const rawScore = combine("raw");
  const weightedScore = combine("weighted");

  return {
    raw_score: rawScore,
    weighted_score: weightedScore,
    tier: tierForWeightedScore(weightedScore),
    pillars: { workplace, resident, od: odPillar },
  };
}
