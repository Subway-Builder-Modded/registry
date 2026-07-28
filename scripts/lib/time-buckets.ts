/** Shared UTC date/hour bucket helpers. */

/** ISO timestamp truncated to the start of the UTC hour. */
export function toHourBucketIso(date: Date): string {
  const bucket = new Date(date.getTime());
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

/** UTC date key in YYYY-MM-DD form, or null when the input does not parse. */
export function toDateKey(isoValue: string): string | null {
  const parsed = Date.parse(isoValue);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** UTC date key in YYYY_MM_DD form, or null when the input does not parse. */
export function toUtcDateKey(isoLike: string): string | null {
  const parsed = Date.parse(isoLike);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10).replaceAll("-", "_");
}
