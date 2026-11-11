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
