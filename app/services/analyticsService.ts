import { and, count, eq, gt, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import { getUnansweredQuestions } from "~/services/commentService";
import {
  CourseStatus,
  LessonProgressStatus,
  UserRole,
  courseRatings,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  users,
} from "~/db/schema";
import {
  getGranularity,
  getPreviousWindow,
  getRangeWindow,
  listBuckets,
  toSeries,
  type Granularity,
  type Range,
  type SeriesPoint,
  type Window,
} from "~/lib/analytics-range";

export { RANGES, DEFAULT_RANGE, parseRange, getRangeWindow, getPreviousWindow } from "~/lib/analytics-range";
export type { Range, Window } from "~/lib/analytics-range";
export type { Granularity, SeriesPoint } from "~/lib/analytics-range";

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

/**
 * SQL condition keeping enrollments that count as "new enrollments": not the
 * course's own instructor and not an admin. Team-coupon redemptions are
 * ordinary enrollments and count. Requires `courses` and `users` joined.
 */
const countedEnrollment = and(
  ne(enrollments.userId, courses.instructorId),
  ne(users.role, UserRole.Admin)
);

/** Number of counted enrollments in courses matching `courseFilter` within a window. */
function enrollmentsInWindow(courseFilter: SQL | undefined, window: Window): number {
  const row = db
    .select({ n: count() })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(courseFilter, countedEnrollment, inWindow(enrollments.enrolledAt, window)))
    .get();
  return row?.n ?? 0;
}

type TimedValue = { at: string; value: number };

/** Each purchase (amount in cents) in courses matching `courseFilter` within a window. */
function purchaseEvents(courseFilter: SQL | undefined, window: Window): TimedValue[] {
  return db
    .select({ at: purchases.createdAt, value: purchases.amountPaid })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(courseFilter, inWindow(purchases.createdAt, window)))
    .all();
}

/** Each counted enrollment (value 1) in courses matching `courseFilter` within a window. */
function enrollmentEvents(courseFilter: SQL | undefined, window: Window): TimedValue[] {
  return db
    .select({ at: enrollments.enrolledAt, value: sql<number>`1` })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(courseFilter, countedEnrollment, inWindow(enrollments.enrolledAt, window)))
    .all();
}

export type OverviewSeries = {
  granularity: Granularity;
  /** Gross revenue in cents per bucket. */
  revenue: SeriesPoint[];
  /** Counted enrollments per bucket. */
  enrollments: SeriesPoint[];
};

/**
 * Revenue and enrollment series for courses matching `courseFilter`, bucketed
 * by the range's granularity (UTC) and zero-filled. Buckets run from the
 * window's start — or, for "all", the earliest sale or enrollment — through
 * `now`; with no data at all, "all" has no buckets.
 */
function seriesFor(courseFilter: SQL | undefined, range: Range, now: Date): OverviewSeries {
  const window = getRangeWindow(range, now);
  const granularity = getGranularity(range);
  const revenue = purchaseEvents(courseFilter, window);
  const enrolled = enrollmentEvents(courseFilter, window);
  const from =
    window.start ??
    [...revenue, ...enrolled].reduce<Date | null>((earliest, { at }) => {
      const date = new Date(at);
      return earliest && earliest <= date ? earliest : date;
    }, null);
  const buckets = from ? listBuckets(from, now, granularity) : [];
  return {
    granularity,
    revenue: toSeries(revenue, buckets, granularity),
    enrollments: toSeries(enrolled, buckets, granularity),
  };
}

export type OverviewTotals = { revenue: number; enrollments: number };

export type InstructorOverview = {
  totals: OverviewTotals;
  /** Same metrics for the preceding equal-length window; null for "all". */
  previous: OverviewTotals | null;
  series: OverviewSeries;
  /** One row per Published/Archived course, by title. */
  courses: CoursePerformanceRow[];
  engagement: OverviewEngagement;
};

/**
 * Headline analytics for an instructor's Published and Archived courses over
 * `range`, ending at `now`. Revenue is gross cents; team purchases count in
 * full on their purchase date. Enrollments exclude the course's instructor
 * and admins.
 */
export function getInstructorOverview(
  instructorId: number,
  range: Range,
  now: Date
): InstructorOverview {
  const window = getRangeWindow(range, now);
  const previousWindow = getPreviousWindow(range, now);
  const courseFilter = instructorAnalyticsCourses(instructorId);
  const totalsIn = (w: Window): OverviewTotals => ({
    revenue: revenueInWindow(instructorId, w),
    enrollments: enrollmentsInWindow(courseFilter, w),
  });
  return {
    totals: totalsIn(window),
    previous: previousWindow ? totalsIn(previousWindow) : null,
    series: seriesFor(courseFilter, range, now),
    ...performanceAndEngagement(instructorId, range, now),
  };
}

// ─── Per-course analytics ───

/** SQL condition selecting one course (by id); pair with `courses`-joined helpers. */
function singleCourse(courseId: number): SQL {
  return eq(courses.id, courseId);
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
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(singleCourse(courseId), countedEnrollment))
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
  totals: OverviewTotals & CourseEngagement;
  /** Revenue and enrollments for the preceding equal-length window; null for "all". */
  previous: OverviewTotals | null;
  /** Revenue and enrollment series for the range, bucketed like the overview. */
  series: OverviewSeries;
};

/**
 * Analytics for one course. Revenue and enrollments cover `range` ending at
 * `now`; completion, activation, and rating are all-time.
 */
export function getCourseAnalytics(courseId: number, range: Range, now: Date): CourseAnalytics {
  const window = getRangeWindow(range, now);
  const previousWindow = getPreviousWindow(range, now);
  const windowed = (w: Window): OverviewTotals => ({
    revenue: courseRevenueInWindow(courseId, w),
    enrollments: enrollmentsInWindow(singleCourse(courseId), w),
  });
  return {
    totals: { ...windowed(window), ...getCourseEngagement(courseId) },
    previous: previousWindow ? windowed(previousWindow) : null,
    series: seriesFor(singleCourse(courseId), range, now),
  };
}

// ─── Overview course performance & engagement headlines ───

/** One course in the overview's performance table. */
export type CoursePerformanceRow = {
  courseId: number;
  title: string;
  status: CourseStatus;
  /** Gross cents within the range. */
  revenue: number;
  /** Counted enrollments within the range. */
  enrollments: number;
  /** All-time, 0–1; null with no counted enrollments. */
  completionRate: number | null;
  /** All-time average stars; null with no ratings. */
  rating: number | null;
};

/**
 * Per-course figures for an instructor's Published and Archived courses,
 * ordered by title. Revenue and enrollments cover `range`; completion and
 * rating are all-time (see `getCourseEngagement`).
 */
function getCoursePerformance(instructorId: number, range: Range, now: Date): CoursePerformanceRow[] {
  const window = getRangeWindow(range, now);
  const rows = db
    .select({ courseId: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(instructorAnalyticsCourses(instructorId))
    .orderBy(courses.title)
    .all();
  return rows.map((course) => {
    const { completionRate, rating } = getCourseEngagement(course.courseId);
    return {
      ...course,
      revenue: courseRevenueInWindow(course.courseId, window),
      enrollments: enrollmentsInWindow(singleCourse(course.courseId), window),
      completionRate,
      rating,
    };
  });
}

/** All-time engagement headlines for the overview. */
export type OverviewEngagement = {
  /** Mean of per-course completion rates over courses with enrollments; null if none. */
  averageCompletion: number | null;
  /** Mean of per-course average ratings over rated courses; null if none. */
  averageRating: number | null;
  /** Questions in the instructor's queue (same rule as the questions page). */
  unansweredQuestions: number;
};

/** Mean of the non-null values, or null when there are none. */
function meanOfPresent(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

function performanceAndEngagement(
  instructorId: number,
  range: Range,
  now: Date
): Pick<InstructorOverview, "courses" | "engagement"> {
  const rows = getCoursePerformance(instructorId, range, now);
  return {
    courses: rows,
    engagement: {
      averageCompletion: meanOfPresent(rows.map((r) => r.completionRate)),
      averageRating: meanOfPresent(rows.map((r) => r.rating)),
      unansweredQuestions: getUnansweredQuestions(instructorId).length,
    },
  };
}
