/**
 * Analytics time ranges and their windows. Pure (no db), so both the
 * analytics service and client components can import it.
 */

export const RANGES = ["30d", "90d", "12m", "all"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "30d";

/** Reads a `range` search-param value, falling back to the default (30d). */
export function parseRange(value: string | null | undefined): Range {
  return RANGES.find((range) => range === value) ?? DEFAULT_RANGE;
}

/**
 * A half-open time window `(start, end]`. `start` is null for "all time".
 * Timestamps are compared as ISO strings, which sort chronologically.
 */
export type Window = { start: Date | null; end: Date };

const DAY_MS = 86_400_000;

/** The window a range covers, ending at `now`. */
export function getRangeWindow(range: Range, now: Date): Window {
  const end = new Date(now);
  switch (range) {
    case "30d":
      return { start: new Date(now.getTime() - 30 * DAY_MS), end };
    case "90d":
      return { start: new Date(now.getTime() - 90 * DAY_MS), end };
    case "12m": {
      const start = new Date(now);
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      return { start, end };
    }
    case "all":
      return { start: null, end };
  }
}

/**
 * The equal-length window immediately before the range's window, or null for
 * "all" (nothing precedes all time).
 */
export function getPreviousWindow(range: Range, now: Date): Window | null {
  const { start } = getRangeWindow(range, now);
  return start ? getRangeWindow(range, start) : null;
}

/** Chart bucket size. All buckets are UTC; weeks start on Monday. */
export type Granularity = "day" | "week" | "month";

/** Bucket size for a range: daily for 30d, weekly for 90d, monthly otherwise. */
export function getGranularity(range: Range): Granularity {
  return range === "30d" ? "day" : range === "90d" ? "week" : "month";
}

/** The UTC start of the bucket containing `date`. */
export function bucketStart(date: Date, granularity: Granularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  switch (granularity) {
    case "day":
      return new Date(Date.UTC(y, m, d));
    case "week":
      return new Date(Date.UTC(y, m, d - ((date.getUTCDay() + 6) % 7)));
    case "month":
      return new Date(Date.UTC(y, m, 1));
  }
}

function nextBucketStart(start: Date, granularity: Granularity): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  switch (granularity) {
    case "day":
      return new Date(Date.UTC(y, m, d + 1));
    case "week":
      return new Date(Date.UTC(y, m, d + 7));
    case "month":
      return new Date(Date.UTC(y, m + 1, 1));
  }
}

/** A bucket's key: its UTC start date as `YYYY-MM-DD`. */
export function bucketKey(date: Date, granularity: Granularity): string {
  return bucketStart(date, granularity).toISOString().slice(0, 10);
}

/** Keys of every bucket from the one containing `from` through the one containing `to`. */
export function listBuckets(from: Date, to: Date, granularity: Granularity): string[] {
  const keys: string[] = [];
  const last = bucketStart(to, granularity).getTime();
  for (let b = bucketStart(from, granularity); b.getTime() <= last; b = nextBucketStart(b, granularity)) {
    keys.push(b.toISOString().slice(0, 10));
  }
  return keys;
}

/** One chart point: a bucket key (see `bucketKey`) and its total. */
export type SeriesPoint = { bucket: string; value: number };

/**
 * Sums timestamped values into `buckets`, zero-filling empty ones. Values
 * whose bucket isn't listed are dropped.
 */
export function toSeries(
  events: { at: string; value: number }[],
  buckets: string[],
  granularity: Granularity
): SeriesPoint[] {
  const totals = new Map(buckets.map((bucket) => [bucket, 0]));
  for (const { at, value } of events) {
    const key = bucketKey(new Date(at), granularity);
    const total = totals.get(key);
    if (total !== undefined) totals.set(key, total + value);
  }
  return buckets.map((bucket) => ({ bucket, value: totals.get(bucket) ?? 0 }));
}
