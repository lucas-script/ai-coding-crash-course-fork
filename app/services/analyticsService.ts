import { and, count, countDistinct, eq, gt, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
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

// ─── Lesson drop-off funnel (#8) ───

export type FunnelLesson = {
  id: number;
  title: string;
  /** Share (0–1) of all counted enrollments that completed this lesson; null with none. */
  completionRate: number | null;
  /** Percentage-point decrease (0–1) from the previous lesson; negative for a rise, null for the first lesson or with no enrollments. */
  dropFromPrevious: number | null;
  /** True for exactly one lesson: the largest drop (earliest on a tie), when any drop exists. */
  isBiggestDrop: boolean;
};

export type FunnelModule = { id: number; title: string; lessons: FunnelLesson[] };

export type CourseFunnel = {
  /** All-time counted enrollments (instructor and admins excluded): the denominator. */
  enrollments: number;
  modules: FunnelModule[];
  /** Lesson with the largest decrease vs its previous lesson; null when nothing drops. */
  biggestDropLessonId: number | null;
};

/** All-time counted enrollments in one course. */
function countedEnrollmentsAllTime(courseId: number): number {
  const row = db
    .select({ n: count() })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(singleCourse(courseId), countedEnrollment))
    .get();
  return row?.n ?? 0;
}

/** Lesson id → number of counted enrollees of the course who completed it. */
function lessonCompletions(courseId: number): Map<number, number> {
  const rows = db
    .select({ lessonId: lessonProgress.lessonId, n: countDistinct(lessonProgress.userId) })
    .from(lessonProgress)
    .innerJoin(
      enrollments,
      and(eq(enrollments.userId, lessonProgress.userId), eq(enrollments.courseId, courseId))
    )
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(eq(lessonProgress.status, LessonProgressStatus.Completed), countedEnrollment))
    .groupBy(lessonProgress.lessonId)
    .all();
  return new Map(rows.map((r) => [r.lessonId, r.n]));
}

/**
 * All-time lesson funnel for one course: every lesson in module then lesson
 * position order, grouped by module, with the share of all counted
 * enrollments that completed it. The denominator is always all enrollments,
 * even for lessons added after students enrolled.
 */
export function getCourseFunnel(courseId: number): CourseFunnel {
  const total = countedEnrollmentsAllTime(courseId);
  const completions = lessonCompletions(courseId);
  const rows = db
    .select({
      moduleId: modules.id,
      moduleTitle: modules.title,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position, modules.id, lessons.position, lessons.id)
    .all();

  // Drops compare completion counts (the denominator is constant) so ties are exact.
  let biggestDropLessonId: number | null = null;
  let biggestDrop = 0;
  let previousCount: number | null = null;
  const grouped: FunnelModule[] = [];
  for (const row of rows) {
    let mod = grouped.at(-1);
    if (mod?.id !== row.moduleId) {
      mod = { id: row.moduleId, title: row.moduleTitle, lessons: [] };
      grouped.push(mod);
    }
    const completed = completions.get(row.lessonId) ?? 0;
    const drop = previousCount === null ? null : previousCount - completed;
    if (total && drop !== null && drop > biggestDrop) {
      biggestDrop = drop;
      biggestDropLessonId = row.lessonId;
    }
    previousCount = completed;
    mod.lessons.push({
      id: row.lessonId,
      title: row.lessonTitle,
      completionRate: total ? completed / total : null,
      dropFromPrevious: total && drop !== null ? drop / total : null,
      isBiggestDrop: false,
    });
  }
  for (const lesson of grouped.flatMap((m) => m.lessons)) {
    lesson.isBiggestDrop = lesson.id === biggestDropLessonId;
  }
  return { enrollments: total, modules: grouped, biggestDropLessonId };
}

export type CourseAnalytics = {
  totals: OverviewTotals & CourseEngagement;
  /** Revenue and enrollments for the preceding equal-length window; null for "all". */
  previous: OverviewTotals | null;
  /** Revenue and enrollment series for the range, bucketed like the overview. */
  series: OverviewSeries;
  /** All-time lesson drop-off funnel (#8). */
  funnel: CourseFunnel;
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
    funnel: getCourseFunnel(courseId),
  };
}
