# Known Data Incidents

Registry-affecting data incidents, their causes, the corrections applied (or
deliberately not applied), and the residual effects to keep in mind when
interpreting download counts and analytics. Append new incidents at the top.

---

## 2026-07-28 — GitHub release download-counter stall (no correction applied)

**Window:** ~08:00–19:20 UTC (≈11.5 hours).

**What happened:** GitHub's release-asset `download_count` metric stopped
incrementing platform-wide. Downloads themselves continued to be served; only
the counters froze. Verified against three independent sources: registry map
counts, the Railyard app's own release repo
(`Subway-Builder-Modded/railyard` — hourly snapshots in
`history/railyard_app_downloads.json` show `0.2.9` pinned at 1295 from 16:00
through 19:00 UTC), and an external control repo (`yt-dlp/yt-dlp`, normally
~70 downloads/minute, byte-identical across samples at 19:12–19:17 UTC).

**Registry symptom:** hourly `regenerate-downloads` PRs carried identical
diffs for hours, then pure "+0" cycles after the frozen snapshot merged
(#6275). The pipeline itself was verified healthy — fetches succeeded and
stored values matched `live_raw − attributed` exactly throughout.

**Impact:** the stall window recorded **+37** net downloads versus a
**~1,774–1,878** baseline for the same window on the two preceding days.
When counters resumed (~19:20 UTC), GitHub replayed only a small fraction of
the backlog (≲100 across the registry; post-recovery hourly cycles landed
inside the normal same-hour baseline band). **≈1,700 downloads registry-wide
are permanently unrecorded.**

**Decision:** accepted without correction. The cause is external and
verifiable, the loss is a single-window dip well inside week-scale variance,
and any backfill would have required fabricating per-version estimates —
contrary to the conservative-corrections policy. Interpret the Jul 28
daily totals accordingly.

**Detection playbook for recurrence:** hourly PRs going "+0/+0" (or repeating
identical diffs) while run logs show successful fetches → spot-check
`stored == live_raw − attributed` for a busy listing, then sample a
high-traffic external repo's `download_count` twice a few minutes apart. If
the control is frozen, it is a platform incident: change nothing, let the
cumulative-counter pipeline pick up whatever GitHub reports after recovery,
and record the measured gap here.

---

## 2026-04-07 → 2026-04-10 — App-side download inflation + integrity invalidation (corrected)

Two related problems, corrected as of 2026-04-11.

### Part 1: inflated download spike (corrected by proportional haircut)

**What happened:** Apr 7–10 download counts spiked artificially from
app-side request behavior, inflating registry counts far above organic
levels.

**Correction:** Apr 6 was the last verifiably clean snapshot and served as
the baseline (deliberately *not* the first spiked date — hard-capping at
Apr 7 would have discarded legitimate organic growth). Each spiked snapshot
was scaled as:

```
corrected = max(apr6Baseline, floor(original × DELTA_HAIRCUT_RATIO))
DELTA_HAIRCUT_RATIO = 0.2864   # weighted avg clamped/pre-clamp across 8 affected mods (1173/4095)
```

Applied by `scripts/backfill-map-version-clamp.ts`.

### Part 2: 14 map versions invalidated by integrity checks (grandfathered)

**What happened:** 14 map versions failed the `config_version_matches_tag`
integrity check (the version in `config.json` did not match the GitHub
release tag). The pipeline marks such versions incomplete and excludes them,
which would have silently dropped their historical download totals —
violating the monotonic non-decrease requirement.

**Correction:** their counts were frozen in
`maps/grandfathered-downloads.json` (the authoritative list of affected
versions and frozen values); `mergeGrandfatheredDownloads()` in
`scripts/lib/grandfathered-downloads.ts` merges the frozen counts back into
pipeline output for incomplete versions only.

**If new versions are invalidated in the future:** add them to
`maps/grandfathered-downloads.json` using the last clean snapshot value from
git history, and check the ceilings in `maps/download-version-buckets.json`.

**Residual effect:** Apr 7–10 totals are corrected estimates, not raw
measurements; the 14 grandfathered versions carry frozen counts that no
longer track upstream.
