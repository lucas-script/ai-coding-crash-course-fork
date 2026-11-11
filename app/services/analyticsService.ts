import { and, eq, gt, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  CourseStatus,
  LessonProgressStatus,
  courseRatings,
  UserRole,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  users,
} from "~/db/schema";
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

// ─── Enrollment exclusions ───

/**
 * SQL condition keeping only enrollments that count toward analytics: drops the
 * course's own instructor and any admin. Self-contained (correlated subqueries
 * on `enrollments`), so it works in any query over `enrollments` without joins.
 */
function countedEnrollment(): SQL {
  return sql`${enrollments.userId} <> (select ${courses.instructorId} from ${courses} where ${courses.id} = ${enrollments.courseId})
    and ${enrollments.userId} not in (select ${users.id} from ${users} where ${users.role} = ${UserRole.Admin})`;
}

// ─── Per-course analytics ───

/** Counted new enrollments in one course within a window. */
function courseEnrollmentsInWindow(courseId: number, window: Window): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, courseId),
        countedEnrollment(),
        inWindow(enrollments.enrolledAt, window)
      )
    )
    .get();
  return row?.count ?? 0;
}

/** Gross revenue (cents) for one course within a window. */
function courseRevenueInWindow(courseId: number, window: Window): number {
  const row = db
    .select({ revenue: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .where(and(eq(purchases.courseId, courseId), inWindow(purchases.createdAt, window)))
    .get();
  return row?.revenue ?? 0;
}

/** All-time engagement for one course. Rates are 0–1, null with no counted enrollments. */
export type CourseEngagement = {
  completionRate: number | null;
  activationRate: number | null;
  /** Average stars (1–5), null with no ratings. */
  rating: number | null;
};

/** SQL: the enrollment's user has started or completed a lesson in its course. */
function enrollmentActivated(): SQL {
  return sql`exists (
    select 1 from ${lessonProgress}
    inner join ${lessons} on ${lessons.id} = ${lessonProgress.lessonId}
    inner join ${modules} on ${modules.id} = ${lessons.moduleId}
    where ${lessonProgress.userId} = ${enrollments.userId}
      and ${modules.courseId} = ${enrollments.courseId}
      and ${lessonProgress.status} in (${LessonProgressStatus.InProgress}, ${LessonProgressStatus.Completed})
  )`;
}

/**
 * All-time completion, activation, and average rating for one course. Rates
 * are over counted enrollments (instructor and admins excluded). Exported so
 * the overview's per-course rows and averages can reuse it.
 */
export function getCourseEngagement(courseId: number): CourseEngagement {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(${enrollments.completedAt})`,
      activated: sql<number>`coalesce(sum(case when ${enrollmentActivated()} then 1 else 0 end), 0)`,
    })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), countedEnrollment()))
    .get();
  const total = row?.total ?? 0;
  const ratingRow = db
    .select({ rating: sql<number | null>`avg(${courseRatings.rating})` })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();
  return {
    completionRate: total ? (row?.completed ?? 0) / total : null,
    activationRate: total ? (row?.activated ?? 0) / total : null,
    rating: ratingRow?.rating ?? null,
  };
}

export type CourseAnalytics = {
  totals: { revenue: number; enrollments: number } & CourseEngagement;
  /** Revenue and enrollments for the preceding equal-length window; null for "all". */
  previous: { revenue: number; enrollments: number } | null;
};

/**
 * Analytics for one course. Revenue and enrollments cover `range` ending at
 * `now`; completion, activation, and rating are all-time.
 */
export function getCourseAnalytics(courseId: number, range: Range, now: Date): CourseAnalytics {
  const window = getRangeWindow(range, now);
  const previousWindow = getPreviousWindow(range, now);
  const windowed = (w: Window) => ({
    revenue: courseRevenueInWindow(courseId, w),
    enrollments: courseEnrollmentsInWindow(courseId, w),
  });
  return {
    totals: { ...windowed(window), ...getCourseEngagement(courseId) },
    previous: previousWindow ? windowed(previousWindow) : null,
  };
}
