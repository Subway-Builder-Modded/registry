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
