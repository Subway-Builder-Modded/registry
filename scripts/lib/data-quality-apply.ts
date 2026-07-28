import {
  DATA_QUALITY_TIERS,
  DataQualityAnswersFileSchema,
  RUBRIC_VERSION,
  type DataQualityAnswersFile,
  type DataQualityTier,
  type ManifestDataQuality,
  type ScoredDataQualityTier,
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

/** A same-country map considered for the quality-floor context. */
export interface CountryFloorPeer {
  id: string;
  tier: ScoredDataQualityTier;
  weightedScore: number;
}

export interface CountryFloorContext {
  /** Plain-text lines for the (code-fenced) rescore_data comment. */
  lines: string[];
  /** True when the confirmed tier sits below the country's best scored tier. */
  floorViolation: boolean;
}

function tierRank(tier: DataQualityTier): number {
  return DATA_QUALITY_TIERS.indexOf(tier);
}

/**
 * Builds the country quality-floor context shown in the rescore_data
 * confirmation comment: the country's other scored maps ranked best-first,
 * plus an explicit FLOOR VIOLATION line when the newly confirmed tier falls
 * below the country's demonstrated best. Advisory by design — whether the
 * city-specific exception applies is reviewer judgment (see the Quality
 * Floor policy).
 */
export function buildCountryFloorContext(
  target: { id: string; country: string; tier: ScoredDataQualityTier },
  peers: CountryFloorPeer[],
): CountryFloorContext {
  const country = target.country || "??";
  if (peers.length === 0) {
    return {
      lines: [
        `Country floor (${country}): no other scored maps — this confirmation sets the floor.`,
      ],
      floorViolation: false,
    };
  }

  const sorted = [...peers].sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) || b.weightedScore - a.weightedScore,
  );
  const best = sorted[0];
  const lines = [
    `Country floor context (${country}):`,
    ...sorted.map(
      (peer) =>
        `  ${peer.tier} (${peer.weightedScore.toFixed(2)})  ${peer.id}`,
    ),
  ];

  const floorViolation = tierRank(target.tier) > tierRank(best.tier);
  if (floorViolation) {
    lines.push(
      `FLOOR VIOLATION: ${target.id} confirmed at ${target.tier}, below the ${country} floor of ${best.tier} (set by ${best.id}).`,
      `A city-specific exception may apply — reviewer judgment. See the Quality Floor policy before merging.`,
    );
  } else {
    lines.push(
      `${target.id} (${target.tier}) meets the ${country} floor (${best.tier}, set by ${best.id}).`,
    );
  }
  return { lines, floorViolation };
}
