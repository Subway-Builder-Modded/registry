import type { AuthorAliasIndex } from "../author-aliases.js";
import type { DiscordEmbed } from "../discord-webhook.js";
import type { IntegrityAlert } from "../download-definitions.js";

export const INTEGRITY_ALERT_EMBED_COLOR = 0xE8890C;

export const INTEGRITY_CHECK_FIX_HINTS: Record<string, string> = {
  // Map checks
  config_json: "Add a `config.json` file to the top level of your ZIP and publish a new release.",
  demand_data: "Add `demand_data.json` or `demand_data.json.gz` to the top level of your ZIP and publish a new release.",
  demand_point_spacing: "Ensure every demand point in `demand_data.json` has at least one neighbor within 100 km, then publish a new release.",
  demand_phantom_points: "Remove demand points with zero residents and zero jobs from `demand_data.json`, then publish a new release.",
  demand_residents_match: "Fix the resident total mismatch in `demand_data.json` (sum across `points` must equal sum across `populations`), then publish a new release.",
  buildings_index: "Add a buildings index (`buildings_index.json/.json.gz` or `.bin/.bin.gz`) to the top level of your ZIP and publish a new release.",
  roads_geojson: "Add `roads.geojson` or `roads.geojson.gz` to the top level of your ZIP and publish a new release.",
  runways_taxiways_geojson: "Add `runways_taxiways.geojson` or `runways_taxiways.geojson.gz` to the top level of your ZIP and publish a new release.",
  city_pmtiles: "Add the `.pmtiles` file matching your `config.json` city code to the top level of your ZIP and publish a new release.",
  config_version_matches_tag: "Update `version` in `config.json` to match the new release tag, then publish a new release.",
  // Mod checks
  zip_manifest_json: "Add `manifest.json` to the top level of your ZIP and publish a new release.",
  manifest_version_matches_tag: "Update `version` in `manifest.json` to match the new release tag, then publish a new release.",
  security_scan_passed: "Remove or fix the files flagged by the security scan (listed in the errors above), then publish a new release.",
  release_manifest_asset: "Publish a new release with `manifest.json` uploaded as a separate release asset alongside the ZIP (not only inside it).",
};

/** Who an integrity alert should notify (ping/mention) — not who authored it. */
export interface AlertNotifyTarget {
  authorId: string;
  alias: string;
  discordId?: string;
  githubId?: number;
}

/**
 * Resolves the person an alert's notifications route to, in priority order:
 * 1. the listing's ACTIVE caretaker (alert.caretakerGithubId, looked up in the
 *    author index by github_id) when set and resolvable — they own the release
 *    pipeline for admin-authored/caretaken listings;
 * 2. the listing author's index entry (by author_id);
 * 3. a bare fallback carrying only the author id (no Discord/GitHub routing).
 * The embed itself keeps showing the listing author; only the target changes.
 */
export function resolveAlertNotifyTarget(
  alert: IntegrityAlert,
  authorIndex: AuthorAliasIndex,
): AlertNotifyTarget {
  if (alert.caretakerGithubId !== undefined) {
    const caretakerEntry = authorIndex.authors.find(
      (entry) => entry.github_id === alert.caretakerGithubId,
    );
    if (caretakerEntry?.author_id) {
      return {
        authorId: caretakerEntry.author_id,
        alias: caretakerEntry.author_alias ?? caretakerEntry.author_id,
        ...(caretakerEntry.discord_id ? { discordId: caretakerEntry.discord_id } : {}),
        ...(caretakerEntry.github_id !== undefined ? { githubId: caretakerEntry.github_id } : {}),
      };
    }
  }
  const authorEntry = authorIndex.authors.find(
    (entry) => entry.author_id === alert.authorId,
  );
  if (authorEntry) {
    return {
      authorId: authorEntry.author_id ?? alert.authorId,
      alias: authorEntry.author_alias ?? authorEntry.author_id ?? alert.authorId,
      ...(authorEntry.discord_id ? { discordId: authorEntry.discord_id } : {}),
      ...(authorEntry.github_id !== undefined ? { githubId: authorEntry.github_id } : {}),
    };
  }
  return { authorId: alert.authorId, alias: alert.authorId };
}

export function buildIntegrityAlertEmbed(
  alert: IntegrityAlert,
  authorAlias: string,
  noDiscordIdNote?: string,
): DiscordEmbed {
  const typeLabel = alert.listingType === "map" ? "Map" : "Mod";
  const regressionLabel = alert.isRegression ? "regression" : "new version failure";

  const lines: string[] = [
    `**${alert.listingName}** \`${alert.version}\``,
    `Author: ${authorAlias} | Status: \`alert\` (${regressionLabel})`,
    "",
    "**Failing checks:**",
    ...alert.failingChecks.map((key) => {
      const hint = INTEGRITY_CHECK_FIX_HINTS[key] ?? "Fix the issue and publish a new release.";
      return `- \`${key}\`: ${hint}`;
    }),
  ];

  if (alert.errors.length > 0) {
    lines.push("", "**Errors:**");
    const maxErrors = 8;
    for (const error of alert.errors.slice(0, maxErrors)) {
      lines.push(`- ${error}`);
    }
    if (alert.errors.length > maxErrors) {
      lines.push(`- ...and ${alert.errors.length - maxErrors} more`);
    }
  }

  if (alert.sourceRepo && alert.sourceTag) {
    lines.push("", `Source: \`${alert.sourceRepo}@${alert.sourceTag}\``);
  }

  let description = lines.join("\n");
  if (description.length > 4000) {
    description = `${description.slice(0, 3997)}...`;
  }

  return {
    title: `[${typeLabel}] Integrity alert: ${alert.listingName} ${alert.version}`,
    description,
    color: INTEGRITY_ALERT_EMBED_COLOR,
    ...(noDiscordIdNote ? { footer: { text: noDiscordIdNote } } : {}),
  };
}

/**
 * Deterministic issue title for an integrity alert — also the cross-run
 * dedup key (an open issue with this exact title suppresses a duplicate).
 */
export function buildIntegrityAlertIssueTitle(alert: IntegrityAlert): string {
  return `[Integrity] ${alert.listingId} ${alert.version}: failing checks`;
}

/**
 * GitHub-issue body mirroring the Discord embed, for notify targets with no
 * discord_id on file. The @mention triggers GitHub's native notification.
 * `mentionLogin` overrides who is @mentioned (e.g. the active caretaker);
 * it defaults to the listing author.
 */
export function buildIntegrityAlertIssueBody(
  alert: IntegrityAlert,
  mentionLogin: string = alert.authorId,
): string {
  const typeLabel = alert.listingType === "map" ? "Map" : "Mod";
  const regressionLabel = alert.isRegression
    ? "a previously-passing version stopped passing"
    : "a new version failed its first check";

  const lines: string[] = [
    `@${mentionLogin} — your ${typeLabel.toLowerCase()} **${alert.listingName}** \`${alert.version}\` is failing integrity checks (${regressionLabel}). Failing versions are excluded from downloads until fixed.`,
    "",
    "**Failing checks:**",
    ...alert.failingChecks.map((key) => {
      const hint = INTEGRITY_CHECK_FIX_HINTS[key] ?? "Fix the issue and publish a new release.";
      return `- \`${key}\`: ${hint}`;
    }),
  ];

  if (alert.errors.length > 0) {
    lines.push("", "**Errors:**");
    const maxErrors = 8;
    for (const error of alert.errors.slice(0, maxErrors)) {
      lines.push(`- ${error}`);
    }
    if (alert.errors.length > maxErrors) {
      lines.push(`- ...and ${alert.errors.length - maxErrors} more`);
    }
  }

  if (alert.sourceRepo && alert.sourceTag) {
    lines.push("", `Source: \`${alert.sourceRepo}@${alert.sourceTag}\``);
  }

  lines.push(
    "",
    "Once a fixed release is published, the next full analytics run picks it up automatically and this issue can be closed.",
    "",
    "_Tip: add a Discord ID via the [Update Author Profile](https://github.com/Subway-Builder-Modded/registry/issues/new?template=update-author.yml) form to get pinged on Discord instead._",
    "",
    "_Automated integrity alert from the full analytics run._",
  );

  return lines.join("\n");
}
