import { and, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import { CourseStatus, courses, purchases } from "~/db/schema";
import {
  getPreviousWindow,
  getRangeWindow,
  type Range,
  type Window,
} from "~/lib/analytics-range";

export { RANGES, DEFAULT_RANGE, parseRange, getRangeWindow, getPreviousWindow } from "~/lib/analytics-range";
export type { Range, Window } from "~/lib/analytics-range";

/** SQL condition placing an ISO-text timestamp column inside a window. */
function inWindow(column: SQLiteColumn, window: Window): SQL | undefined {
  return and(
    window.start ? gt(column, window.start.toISOString()) : undefined,
    lte(column, window.end.toISOString())
  );
}

/** Courses that count toward analytics: Published and Archived, never Draft. */
const ANALYTICS_COURSE_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

/** SQL condition selecting an instructor's courses that count toward analytics. */
function instructorAnalyticsCourses(instructorId: number): SQL | undefined {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, ANALYTICS_COURSE_STATUSES)
  );
}

/** Gross revenue (cents) for an instructor's courses within a window. */
function revenueInWindow(instructorId: number, window: Window): number {
  const row = db
    .select({ revenue: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(instructorAnalyticsCourses(instructorId), inWindow(purchases.createdAt, window)))
    .get();
  return row?.revenue ?? 0;
}

export type InstructorOverview = {
  totals: { revenue: number };
  /** Same metrics for the preceding equal-length window; null for "all". */
  previous: { revenue: number } | null;
};

/**
 * Headline analytics for an instructor's Published and Archived courses over
 * `range`, ending at `now`. Revenue is gross cents; team purchases count in
 * full on their purchase date.
 */
export function getInstructorOverview(
  instructorId: number,
  range: Range,
  now: Date
): InstructorOverview {
  const window = getRangeWindow(range, now);
  const previousWindow = getPreviousWindow(range, now);
  return {
    totals: { revenue: revenueInWindow(instructorId, window) },
    previous: previousWindow ? { revenue: revenueInWindow(instructorId, previousWindow) } : null,
  };
}
