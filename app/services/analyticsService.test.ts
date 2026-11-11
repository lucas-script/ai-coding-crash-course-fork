import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getCourseAnalytics, getInstructorOverview, parseRange } from "./analyticsService";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function purchase(amountPaid: number, createdAt: string, courseId = base.course.id) {
  return testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("parseRange", () => {
    it("accepts the four known ranges", () => {
      expect(["30d", "90d", "12m", "all"].map(parseRange)).toEqual(["30d", "90d", "12m", "all"]);
    });

    it("defaults to 30d for a missing or unknown value", () => {
      expect(parseRange(null)).toBe("30d");
      expect(parseRange("7d")).toBe("30d");
    });
  });

  describe("getInstructorOverview — revenue", () => {
    it("sums amounts paid on the instructor's purchases within the last 30 days", () => {
      purchase(4999, "2026-06-10T00:00:00.000Z");
      purchase(2500, "2026-05-20T00:00:00.000Z");

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals.revenue).toBe(7499);
    });

    it("window is (now - 30 days, now]: the start instant is out, now is in, the future is out", () => {
      purchase(1, "2026-05-16T12:00:00.000Z"); // exactly 30 days before now — excluded
      purchase(10, "2026-05-16T12:00:00.001Z"); // just inside
      purchase(100, "2026-06-15T12:00:00.000Z"); // exactly now — included
      purchase(1000, "2026-06-15T12:00:00.001Z"); // after now — excluded

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.revenue).toBe(110);
    });

    it("90d covers the last 90 days", () => {
      purchase(10, "2026-03-17T12:00:00.001Z"); // 90 days minus 1ms before now
      purchase(1, "2026-03-17T12:00:00.000Z"); // exactly 90 days before

      expect(getInstructorOverview(base.instructor.id, "90d", NOW).totals.revenue).toBe(10);
    });

    it("12m covers the last 12 calendar months", () => {
      purchase(10, "2025-06-15T12:00:00.001Z");
      purchase(1, "2025-06-15T12:00:00.000Z");

      expect(getInstructorOverview(base.instructor.id, "12m", NOW).totals.revenue).toBe(10);
    });

    it("all covers every purchase up to now", () => {
      purchase(10, "2015-01-01T00:00:00.000Z");
      purchase(20, "2026-06-15T12:00:00.000Z");
      purchase(1000, "2026-07-01T00:00:00.000Z"); // future — excluded

      expect(getInstructorOverview(base.instructor.id, "all", NOW).totals.revenue).toBe(30);
    });
  });

  describe("getInstructorOverview — which purchases count", () => {
    function course(overrides: Partial<typeof schema.courses.$inferInsert>) {
      return testDb
        .insert(schema.courses)
        .values({
          title: "Other",
          slug: `other-${Math.random()}`,
          description: "",
          salesCopy: "",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
          ...overrides,
        })
        .returning()
        .get();
    }

    it("excludes draft courses and includes archived ones", () => {
      const draft = course({ status: schema.CourseStatus.Draft });
      const archived = course({ status: schema.CourseStatus.Archived });
      purchase(100, "2026-06-01T00:00:00.000Z");
      purchase(1000, "2026-06-01T00:00:00.000Z", draft.id);
      purchase(10, "2026-06-01T00:00:00.000Z", archived.id);

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.revenue).toBe(110);
    });

    it("only counts the instructor's own courses", () => {
      const other = testDb
        .insert(schema.users)
        .values({ name: "Other", email: "other@example.com", role: schema.UserRole.Instructor })
        .returning()
        .get();
      const theirs = course({ instructorId: other.id });
      purchase(100, "2026-06-01T00:00:00.000Z");
      purchase(1000, "2026-06-01T00:00:00.000Z", theirs.id);

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.revenue).toBe(100);
      expect(getInstructorOverview(other.id, "30d", NOW).totals.revenue).toBe(1000);
    });

    it("counts a team purchase in full on its purchase date, regardless of seat redemption", () => {
      const teamPurchase = purchase(5 * 4999, "2026-05-01T00:00:00.000Z"); // previous window
      const team = testDb.insert(schema.teams).values({}).returning().get();
      for (let i = 0; i < 5; i++) {
        testDb
          .insert(schema.coupons)
          .values({
            teamId: team.id,
            courseId: base.course.id,
            code: `SEAT-${i}`,
            purchaseId: teamPurchase.id,
            redeemedByUserId: i === 0 ? base.user.id : null,
            redeemedAt: i === 0 ? "2026-06-10T00:00:00.000Z" : null, // redeemed in current window
          })
          .run();
      }

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals.revenue).toBe(0);
      expect(overview.previous).toEqual({ revenue: 24995 });
    });

    it("returns zeros when there is no data", () => {
      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals.revenue).toBe(0);
      expect(overview.previous).toEqual({ revenue: 0 });
    });
  });

  describe("getInstructorOverview — previous period", () => {
    it("reports revenue for the immediately preceding equal-length window", () => {
      purchase(100, "2026-06-01T00:00:00.000Z"); // current 30d
      purchase(10, "2026-05-16T12:00:00.000Z"); // exactly at the boundary — previous window
      purchase(20, "2026-04-16T12:00:00.001Z"); // just inside previous window
      purchase(1, "2026-04-16T12:00:00.000Z"); // 60 days ago — outside both

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals.revenue).toBe(100);
      expect(overview.previous).toEqual({ revenue: 30 });
    });

    it("compares 12m against the 12 months before that", () => {
      purchase(50, "2025-01-01T00:00:00.000Z");
      purchase(1, "2024-06-15T12:00:00.000Z"); // exactly 24 months ago — excluded

      expect(getInstructorOverview(base.instructor.id, "12m", NOW).previous).toEqual({
        revenue: 50,
      });
    });

    it("is null for all time", () => {
      purchase(100, "2026-06-01T00:00:00.000Z");

      expect(getInstructorOverview(base.instructor.id, "all", NOW).previous).toBeNull();
    });
  });

  describe("getCourseAnalytics", () => {
    function user(role: schema.UserRole, name = `u-${Math.random()}`) {
      return testDb
        .insert(schema.users)
        .values({ name, email: `${name}@example.com`, role })
        .returning()
        .get();
    }

    function otherCourse() {
      return testDb
        .insert(schema.courses)
        .values({
          title: "Other",
          slug: `other-${Math.random()}`,
          description: "",
          salesCopy: "",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
    }

    it("sums revenue for just that course within the range, with the previous window", () => {
      const other = otherCourse();
      purchase(100, "2026-06-01T00:00:00.000Z");
      purchase(1000, "2026-06-01T00:00:00.000Z", other.id);
      purchase(20, "2026-05-01T00:00:00.000Z"); // previous 30d

      const analytics = getCourseAnalytics(base.course.id, "30d", NOW);

      expect(analytics.totals.revenue).toBe(100);
      expect(analytics.previous?.revenue).toBe(20);
    });

    function enroll(
      userId: number,
      enrolledAt = "2026-06-01T00:00:00.000Z",
      completedAt: string | null = null,
      courseId = base.course.id
    ) {
      return testDb
        .insert(schema.enrollments)
        .values({ userId, courseId, enrolledAt, completedAt })
        .returning()
        .get();
    }

    it("counts new enrollments in the range and the previous window, excluding the instructor and admins", () => {
      enroll(base.user.id, "2026-06-01T00:00:00.000Z");
      enroll(user(schema.UserRole.Student).id, "2026-05-01T00:00:00.000Z"); // previous
      enroll(user(schema.UserRole.Student).id, "2026-01-01T00:00:00.000Z"); // outside both
      enroll(base.instructor.id, "2026-06-01T00:00:00.000Z"); // own course — excluded
      enroll(user(schema.UserRole.Admin).id, "2026-06-01T00:00:00.000Z"); // admin — excluded
      enroll(user(schema.UserRole.Student).id, "2026-06-01T00:00:00.000Z", null, otherCourse().id);

      const analytics = getCourseAnalytics(base.course.id, "30d", NOW);

      expect(analytics.totals.enrollments).toBe(1);
      expect(analytics.previous?.enrollments).toBe(1);
    });

    it("counts another instructor enrolled as a student", () => {
      enroll(user(schema.UserRole.Instructor).id);

      expect(getCourseAnalytics(base.course.id, "30d", NOW).totals.enrollments).toBe(1);
    });

    it("completion rate is completed ÷ all counted enrollments, all-time and ignoring the range", () => {
      enroll(base.user.id, "2020-01-01T00:00:00.000Z", "2020-02-01T00:00:00.000Z");
      enroll(user(schema.UserRole.Student).id, "2026-06-01T00:00:00.000Z");
      enroll(user(schema.UserRole.Student).id, "2026-06-01T00:00:00.000Z");
      enroll(user(schema.UserRole.Student).id, "2021-01-01T00:00:00.000Z", "2021-03-01T00:00:00.000Z");
      // Excluded completions must not lift the rate
      enroll(base.instructor.id, "2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");
      enroll(user(schema.UserRole.Admin).id, "2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z");

      expect(getCourseAnalytics(base.course.id, "30d", NOW).totals.completionRate).toBe(0.5);
      expect(getCourseAnalytics(base.course.id, "all", NOW).totals.completionRate).toBe(0.5);
    });

    function lessonIn(courseId: number) {
      const mod = testDb
        .insert(schema.modules)
        .values({ courseId, title: "M", position: 1 })
        .returning()
        .get();
      return testDb
        .insert(schema.lessons)
        .values({ moduleId: mod.id, title: "L", position: 1 })
        .returning()
        .get();
    }

    function progress(userId: number, lessonId: number, status: schema.LessonProgressStatus) {
      testDb.insert(schema.lessonProgress).values({ userId, lessonId, status }).run();
    }

    it("activation rate is enrollments with a lesson started or completed in this course ÷ all counted enrollments", () => {
      const lesson = lessonIn(base.course.id);
      const otherLesson = lessonIn(otherCourse().id);
      const started = user(schema.UserRole.Student);
      const finished = user(schema.UserRole.Student);
      const notStarted = user(schema.UserRole.Student);
      const elsewhere = user(schema.UserRole.Student);
      const admin = user(schema.UserRole.Admin);
      for (const u of [started, finished, notStarted, elsewhere, admin]) enroll(u.id);
      enroll(base.instructor.id);
      progress(started.id, lesson.id, schema.LessonProgressStatus.InProgress);
      progress(finished.id, lesson.id, schema.LessonProgressStatus.Completed);
      progress(notStarted.id, lesson.id, schema.LessonProgressStatus.NotStarted);
      progress(elsewhere.id, otherLesson.id, schema.LessonProgressStatus.Completed); // other course
      progress(admin.id, lesson.id, schema.LessonProgressStatus.Completed); // excluded
      progress(base.instructor.id, lesson.id, schema.LessonProgressStatus.Completed); // excluded

      expect(getCourseAnalytics(base.course.id, "30d", NOW).totals.activationRate).toBe(0.5);
    });

    it("rating is the all-time average of that course's ratings", () => {
      const other = otherCourse();
      const rate = (userId: number, rating: number, courseId = base.course.id) =>
        testDb.insert(schema.courseRatings).values({ userId, courseId, rating }).run();
      rate(base.user.id, 5);
      rate(user(schema.UserRole.Student).id, 4);
      rate(user(schema.UserRole.Student).id, 2, other.id);

      expect(getCourseAnalytics(base.course.id, "30d", NOW).totals.rating).toBe(4.5);
    });

    it("returns zeros and nulls when the course has no data", () => {
      expect(getCourseAnalytics(base.course.id, "30d", NOW)).toEqual({
        totals: {
          revenue: 0,
          enrollments: 0,
          completionRate: null,
          activationRate: null,
          rating: null,
        },
        previous: { revenue: 0, enrollments: 0 },
      });
    });

    it("has no previous window for all time", () => {
      expect(getCourseAnalytics(base.course.id, "all", NOW).previous).toBeNull();
    });
  });
});
