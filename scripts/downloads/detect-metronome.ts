import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagValue, hasFlag } from "../lib/cli.js";
import { loadHourlySeries } from "../lib/hourly-downloads.js";
import { isObject } from "../lib/json-utils.js";
import {
  detectLockstepCohorts,
  measureLocalExcess,
  trackKnownLoop,
  windowHours,
  type CohortMemberStats,
  type LockstepCohort,
} from "../lib/metronome-detection.js";
import { appendGitHubOutput, resolveRepoRoot, runAndExitOnError } from "../lib/script-runtime.js";

// Daily metronome guard, detection half (metronome-guard.yml). Report-only: it
// never attributes anything.
//   Known loops — for every open loop-repair spec, the loop's lockstep hours
//     are derived from the listings the spec targets. Flagged: listings riding
//     those hours that no open spec covers, and targeted listings whose
//     downloads moved to a version the spec does not target (eu-maps 0.8.1).
//   Stale riders — open rider targets (no `end`) of a loop that is still
//     running whose last-7-day excess fell well below their `per_cycle`: the
//     engine keeps attributing per_cycle × slots until a maintainer sets `end`.
//   Candidates — lockstep cohorts discovered from scratch that share no
//     listing with an open spec. Long pack-release waves can qualify, so each
//     is annotated with how many members released a version in the window.
// A maintainer writes or extends a spec; specs opted in with
// `auto_apply: true` are then re-applied daily by the same workflow.
//
//   pnpm --dir scripts run detect-metronome [-- --end YYYY-MM-DD] [--days 14]
//   pnpm --dir scripts run detect-metronome -- --list-auto-apply

const SPEC_DIR = "history/loop-repair-specs";
const DEFAULT_OUT_DIR = "tmp/metronome-guard";
const DEFAULT_WINDOW_DAYS = 14;
// Stale-rider check: recent loop hours measured, the share of the spec rate
// below which a rider counts as gone, and the loop hours needed to judge.
const STALE_RIDER_DAYS = 7;
const STALE_RIDER_SHARE = 0.4;
const STALE_RIDER_MIN_SAMPLES = 10;

interface OpenSpec {
  path: string;
  incident: string;
  autoApply: boolean;
  // "map:listing-id" → versions targeted for the current window (riders too).
  versionsByListing: Map<string, Set<string>>;
  // The listings whose shared hours define the loop: rider_loop.core when the
  // spec has one (the engine's clock), otherwise its non-rider targets.
  coreKeys: string[];
  // Rider targets with no `end` — attributed every day the loop runs.
  openRiders: OpenRider[];
}

interface OpenRider {
  key: string;
  version: string;
  start: string;
  perCycle: number;
}

type VersionCounts = Record<string, Record<string, number>>;

interface SnapshotWindow {
  first: { maps: VersionCounts; mods: VersionCounts } | null;
  last: { maps: VersionCounts; mods: VersionCounts } | null;
  // "map:listing-id" → version → first snapshot date it appeared in the window.
  firstSeen: Map<string, Map<string, string>>;
}

function loadOpenSpecs(repoRoot: string, windowStart: string): OpenSpec[] {
  const dir = resolve(repoRoot, SPEC_DIR);
  if (!existsSync(dir)) return [];
  const specs: OpenSpec[] = [];
  for (const fileName of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const raw = JSON.parse(readFileSync(resolve(dir, fileName), "utf-8")) as unknown;
    if (!isObject(raw)) continue;
    const incidentEnd = typeof raw.incident_end === "string" ? raw.incident_end : null;
    if (incidentEnd && incidentEnd < windowStart) continue;
    const versionsByListing = new Map<string, Set<string>>();
    for (const list of [raw.targets, raw.adoption_targets, raw.rider_targets]) {
      if (!Array.isArray(list)) continue;
      for (const target of list) {
        if (!isObject(target) || typeof target.listing_id !== "string" || typeof target.version !== "string") continue;
        const key = `${target.listing_type === "mod" ? "mod" : "map"}:${target.listing_id}`;
        if (!versionsByListing.has(key)) versionsByListing.set(key, new Set());
        // Adoption targets end at incident_end, rider targets at end.
        const targetEnd = typeof target.incident_end === "string" ? target.incident_end
          : typeof target.end === "string" ? target.end : null;
        if (!targetEnd || targetEnd >= windowStart) versionsByListing.get(key)!.add(target.version);
      }
    }
    const riderKeys = new Set(
      (Array.isArray(raw.rider_targets) ? raw.rider_targets : [])
        .filter(isObject)
        .map((target) => `${target.listing_type === "mod" ? "mod" : "map"}:${String(target.listing_id)}`),
    );
    const openRiders = (Array.isArray(raw.rider_targets) ? raw.rider_targets : [])
      .filter(isObject)
      .filter((target) => target.end == null && typeof target.per_cycle === "number" && typeof target.start === "string")
      .map((target) => ({
        key: `${target.listing_type === "mod" ? "mod" : "map"}:${String(target.listing_id)}`,
        version: String(target.version),
        start: target.start as string,
        perCycle: target.per_cycle as number,
      }));
    const riderCore = isObject(raw.rider_loop) && Array.isArray(raw.rider_loop.core)
      ? raw.rider_loop.core.filter(isObject).map((entry) => `${entry.listing_type === "mod" ? "mod" : "map"}:${String(entry.listing_id)}`)
      : [];
    specs.push({
      path: `${SPEC_DIR}/${fileName}`,
      incident: typeof raw.incident === "string" ? raw.incident : fileName,
      autoApply: raw.auto_apply === true,
      versionsByListing,
      coreKeys: riderCore.length > 0 ? riderCore : [...versionsByListing.keys()].filter((key) => !riderKeys.has(key)),
      openRiders,
    });
  }
  return specs;
}

// Snapshots are dated by their ~04:00Z generation day, so the snapshots dated
// startDate..endDate bracket the window.
function loadSnapshotWindow(repoRoot: string, startDate: string, endDate: string): SnapshotWindow {
  const dir = resolve(repoRoot, "history");
  const files = readdirSync(dir)
    .filter((name) => /^snapshot_\d{4}_\d{2}_\d{2}\.json$/.test(name))
    .map((name) => ({ name, date: name.slice(9, 19).replaceAll("_", "-") }))
    .filter(({ date }) => date >= startDate && date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const read = (name: string) => {
    const data = JSON.parse(readFileSync(resolve(dir, name), "utf-8")) as Record<string, { raw_downloads?: VersionCounts; downloads?: VersionCounts }>;
    return {
      maps: data.maps?.raw_downloads ?? data.maps?.downloads ?? {},
      mods: data.mods?.raw_downloads ?? data.mods?.downloads ?? {},
    };
  };
  const firstSeen = new Map<string, Map<string, string>>();
  let first: SnapshotWindow["first"] = null;
  let last: SnapshotWindow["last"] = null;
  for (const { name, date } of files) {
    const snapshot = read(name);
    if (!first) first = snapshot;
    last = snapshot;
    for (const [type, section] of [["map", snapshot.maps], ["mod", snapshot.mods]] as const) {
      for (const [id, versions] of Object.entries(section)) {
        const key = `${type}:${id}`;
        if (!firstSeen.has(key)) firstSeen.set(key, new Map());
        for (const version of Object.keys(versions)) {
          if (!firstSeen.get(key)!.has(version)) firstSeen.get(key)!.set(version, date);
        }
      }
    }
  }
  return { first, last, firstSeen };
}

// The version whose raw counter grew most across the window — where the loop
// is landing now. Null when either bracketing snapshot is missing.
function activeVersion(snapshots: SnapshotWindow, key: string): string | null {
  if (!snapshots.first || !snapshots.last) return null;
  const [type, id] = key.split(/:(.*)/s) as [string, string];
  const section = type === "mod" ? "mods" : "maps";
  let best: string | null = null;
  let bestDelta = 0;
  for (const [version, count] of Object.entries(snapshots.last[section][id] ?? {})) {
    const delta = count - (snapshots.first[section][id]?.[version] ?? 0);
    if (delta > bestDelta) {
      best = version;
      bestDelta = delta;
    }
  }
  return best;
}

type MemberStatus = "covered" | "untargeted-version" | "uncovered";

interface ReportMember extends CohortMemberStats {
  activeVersion: string | null;
  status: MemberStatus;
  specs: string[];
}

function describeMember(member: CohortMemberStats, snapshots: SnapshotWindow, specs: OpenSpec[]): ReportMember {
  const version = activeVersion(snapshots, member.key);
  const covering = specs.filter((spec) => spec.versionsByListing.has(member.key));
  let status: MemberStatus = "uncovered";
  if (covering.length > 0) {
    // No measurable growth means nothing is landing on an untargeted version.
    const targeted = version === null || covering.some((spec) => spec.versionsByListing.get(member.key)!.has(version));
    status = targeted ? "covered" : "untargeted-version";
  }
  return { ...member, activeVersion: version, status, specs: covering.map((spec) => spec.incident) };
}

function describeCohort(cohort: LockstepCohort, snapshots: SnapshotWindow, specs: OpenSpec[], windowStart: string) {
  const members = cohort.members.map((member) => describeMember(member, snapshots, specs));
  const core = members.filter((member) => member.role === "core");
  const released = core.filter((member) =>
    member.activeVersion !== null && (snapshots.firstSeen.get(member.key)?.get(member.activeVersion) ?? "") > windowStart).length;
  return {
    classification: cohort.classification,
    reason: cohort.reason,
    lockstepHours: cohort.lockstepHours.length,
    dailyLockstepHours: cohort.dailyLockstepHours,
    releasedInWindow: released,
    members,
  };
}

// Deprecated listings are frozen out of pipeline output, so the hourly series
// cannot see a loop that keeps fetching them upstream (the holdouts).
function isDeprecated(repoRoot: string, key: string): boolean {
  const [type, id] = key.split(/:(.*)/s) as [string, string];
  const path = resolve(repoRoot, type === "mod" ? "mods" : "maps", id, "manifest.json");
  if (!existsSync(path)) return false;
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  return isObject(manifest.deprecation);
}

interface RiderCheck {
  target: string;
  perCycle: number;
  recentExcess: number;
  standardError: number;
  samples: number;
  status: "riding" | "stale" | "too-new";
}

// Each open rider's excess over the loop's lockstep hours in the last
// STALE_RIDER_DAYS days, against its spec rate. A rider that joined inside that
// stretch is not judged yet.
function checkOpenRiders(
  spec: OpenSpec,
  series: ReturnType<typeof loadHourlySeries>,
  hours: string[],
  lockstepHours: string[],
  endDate: string,
): RiderCheck[] {
  const recentHours = windowHours(endDate, STALE_RIDER_DAYS);
  const recentStart = recentHours[0]!.slice(0, 10);
  const recentSet = new Set(recentHours);
  const recentLockstep = lockstepHours.filter((hour) => recentSet.has(hour));
  return spec.openRiders.map((rider) => {
    const excess = measureLocalExcess(series.get(rider.key), hours, recentLockstep);
    const status: RiderCheck["status"] = rider.start > recentStart || excess.samples < STALE_RIDER_MIN_SAMPLES
      ? "too-new"
      : excess.mean < STALE_RIDER_SHARE * rider.perCycle ? "stale" : "riding";
    return {
      target: `${rider.key}@${rider.version}`,
      perCycle: rider.perCycle,
      recentExcess: excess.mean,
      standardError: excess.standardError,
      samples: excess.samples,
      status,
    };
  });
}

function buildReport(repoRoot: string, endDate: string, days: number) {
  const hours = windowHours(endDate, days);
  const startDate = hours[0]!.slice(0, 10);
  const specs = loadOpenSpecs(repoRoot, startDate);
  const series = loadHourlySeries(repoRoot, hours);
  const snapshots = loadSnapshotWindow(repoRoot, startDate, endDate);

  const knownLoops = specs.map((spec) => {
    const tracked = trackKnownLoop(series, hours, spec.coreKeys);
    const cohort = describeCohort(tracked, snapshots, specs, startDate);
    // Riders and version moves only mean something while the loop is running.
    const flagged = cohort.classification !== "metronome" ? [] : cohort.members.filter((member) =>
      (member.role === "rider" && member.status === "uncovered") || member.status === "untargeted-version");
    const frozen = spec.coreKeys.every((key) => isDeprecated(repoRoot, key));
    // A quiet loop has no slots, so its open riders attribute nothing.
    const riderChecks = cohort.classification === "metronome"
      ? checkOpenRiders(spec, series, hours, tracked.lockstepHours, endDate)
      : [];
    return {
      spec: spec.path,
      incident: spec.incident,
      autoApply: spec.autoApply,
      state: cohort.classification === "metronome" ? "looping" as const : frozen ? "frozen" as const : "quiet" as const,
      ...cohort,
      flagged: flagged.map((member) => member.key),
      riderChecks,
    };
  });
  const knownKeys = new Set(specs.flatMap((spec) => [...spec.versionsByListing.keys()]));
  const candidates = detectLockstepCohorts(series, hours)
    .filter((cohort) => cohort.classification === "metronome")
    .filter((cohort) => !cohort.members.some((member) => member.role === "core" && knownKeys.has(member.key)))
    .map((cohort) => describeCohort(cohort, snapshots, specs, startDate));

  const flagged = new Set<string>();
  for (const loop of knownLoops) for (const key of loop.flagged) flagged.add(key);
  for (const candidate of candidates) for (const member of candidate.members) if (member.status === "uncovered") flagged.add(member.key);
  const staleRiders = knownLoops.flatMap((loop) =>
    loop.riderChecks.filter((check) => check.status === "stale").map((check) => check.target)).sort();
  return {
    window: { start: startDate, end: endDate, days },
    knownLoops,
    candidates,
    flagged: [...flagged].sort(),
    staleRiders,
  };
}

type Report = ReturnType<typeof buildReport>;

function memberTable(members: ReportMember[]): string[] {
  return [
    "| Listing | Role | Downloading version | Status | Excess per loop hour | Lockstep downloads/day | Lockstep share |",
    "|---|---|---|---|---|---|---|",
    ...members.map((member) =>
      `| \`${member.key}\` | ${member.role} | ${member.activeVersion ?? "—"} | ${member.status}${member.specs.length ? ` (${member.specs.join(", ")})` : ""} | ${member.excessPerLockstepHour >= 0 ? "+" : ""}${member.excessPerLockstepHour.toFixed(2)} | ${member.lockstepDownloadsPerDay.toFixed(1)} | ${(100 * member.lockstepShare).toFixed(0)}% |`),
  ];
}

function renderMarkdown(report: Report): string {
  const lines = [
    `Window: ${report.window.start} → ${report.window.end} (UTC, end exclusive, ${report.window.days} days).`,
    "",
    "## Known loops (open loop-repair specs)",
    "",
  ];
  if (report.knownLoops.length === 0) lines.push("No open loop-repair specs.", "");
  for (const loop of report.knownLoops) {
    const needsAction = loop.members.filter((member) => loop.flagged.includes(member.key));
    const stateNote = {
      looping: "",
      quiet: " If it stays quiet, consider setting `incident_end`.",
      frozen: " Every target is deprecated, so its counts are frozen and the hourly series cannot see the loop; check the live GitHub counters before closing.",
    }[loop.state];
    lines.push(
      `### \`${loop.incident}\` — ${{ looping: "still looping", quiet: "quiet", frozen: "frozen (all targets deprecated)" }[loop.state]}${loop.autoApply ? " (auto-applied daily)" : ""}`,
      "",
      `Lockstep hours per day: \`${loop.dailyLockstepHours.join(" ")}\` — ${loop.reason}.${stateNote}`,
      "",
    );
    if (needsAction.length > 0) {
      lines.push("**Needs a spec change** (rides this loop but is not targeted):", "", ...memberTable(needsAction), "");
    } else {
      lines.push("Every listing riding this loop is targeted.", "");
    }
    if (loop.riderChecks.length > 0) {
      const stale = loop.riderChecks.filter((check) => check.status === "stale");
      lines.push(
        stale.length > 0
          ? `**Stale rider target(s)** — excess over the last ${STALE_RIDER_DAYS} days is below ${100 * STALE_RIDER_SHARE}% of the spec rate; set \`end\` once confirmed, or the engine keeps attributing per_cycle × slots: ${stale.map((check) => `\`${check.target}\``).join(", ")}.`
          : `Open rider targets are still riding at their spec rates (last ${STALE_RIDER_DAYS} days).`,
        "",
        "| Rider target | Spec rate | Last-7-day excess per loop hour | Loop hours | Status |",
        "|---|---|---|---|---|",
        ...loop.riderChecks.map((check) =>
          `| \`${check.target}\` | ${check.perCycle} | ${check.recentExcess >= 0 ? "+" : ""}${check.recentExcess.toFixed(2)} ± ${check.standardError.toFixed(2)} | ${check.samples} | ${check.status} |`),
        "",
      );
    }
  }
  lines.push("## New candidates (review — long pack-release waves can qualify)", "");
  if (report.candidates.length === 0) lines.push("None.", "");
  report.candidates.forEach((candidate, index) => {
    const core = candidate.members.filter((member) => member.role === "core").length;
    lines.push(
      `### Candidate ${index + 1} — ${candidate.members.length} listings, ${candidate.lockstepHours} lockstep hours`,
      "",
      `Lockstep hours per day: \`${candidate.dailyLockstepHours.join(" ")}\` — ${candidate.reason}. ${candidate.releasedInWindow} of ${core} core listings released a new version in the window${candidate.releasedInWindow > core / 2 ? " — check for a pack-release wave first" : ""}.`,
      "",
      ...memberTable(candidate.members),
      "",
    );
  });
  return lines.join("\n");
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const repoRoot = process.env.RAILYARD_REPO_ROOT ?? resolveRepoRoot(import.meta.dirname);
  const endDate = getFlagValue(argv, "end")?.trim() || new Date().toISOString().slice(0, 10);
  const days = Number(getFlagValue(argv, "days") ?? DEFAULT_WINDOW_DAYS);
  if (!Number.isInteger(days) || days < 3) throw new Error("--days must be an integer ≥ 3.");

  if (hasFlag(argv, "list-auto-apply")) {
    for (const spec of loadOpenSpecs(repoRoot, endDate)) if (spec.autoApply) console.log(spec.path);
    return;
  }

  const report = buildReport(repoRoot, endDate, days);
  const outDir = resolve(repoRoot, getFlagValue(argv, "out-dir")?.trim() || DEFAULT_OUT_DIR);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  writeFileSync(resolve(outDir, "report.md"), renderMarkdown(report), "utf-8");

  console.log(
    `[detect-metronome] ${report.window.start}..${report.window.end}: ${report.knownLoops.length} known loop(s) (${report.knownLoops.filter((loop) => loop.state === "looping").length} looping), ${report.candidates.length} candidate(s), ${report.flagged.length} flagged listing(s), ${report.staleRiders.length} stale rider target(s)`,
  );
  for (const key of report.flagged) console.log(`  flagged: ${key}`);
  for (const target of report.staleRiders) console.log(`  stale rider: ${target}`);
  appendGitHubOutput([`flagged_count=${report.flagged.length}`, `stale_rider_count=${report.staleRiders.length}`, `report_dir=${outDir}`]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runAndExitOnError(run);
}
