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

function student(name: string, role: schema.UserRole = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function enroll(userId: number, enrolledAt: string, courseId = base.course.id) {
  testDb.insert(schema.enrollments).values({ userId, courseId, enrolledAt }).run();
}

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
      expect(overview.previous?.revenue).toBe(24995);
    });

    it("returns zeros when there is no data", () => {
      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals).toEqual({ revenue: 0, enrollments: 0 });
      expect(overview.previous).toEqual({ revenue: 0, enrollments: 0 });
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
      expect(overview.previous?.revenue).toBe(30);
    });

    it("compares 12m against the 12 months before that", () => {
      purchase(50, "2025-01-01T00:00:00.000Z");
      purchase(1, "2024-06-15T12:00:00.000Z"); // exactly 24 months ago — excluded

      expect(getInstructorOverview(base.instructor.id, "12m", NOW).previous?.revenue).toBe(50);
    });

    it("is null for all time", () => {
      purchase(100, "2026-06-01T00:00:00.000Z");

      expect(getInstructorOverview(base.instructor.id, "all", NOW).previous).toBeNull();
    });
  });

  describe("getInstructorOverview — new enrollments", () => {
    it("counts enrollments in the window and the previous window", () => {
      enroll(student("a").id, "2026-06-10T00:00:00.000Z");
      enroll(student("b").id, "2026-05-16T12:00:00.001Z");
      enroll(student("c").id, "2026-05-16T12:00:00.000Z"); // boundary — previous window
      enroll(student("d").id, "2026-06-15T12:00:00.001Z"); // future — excluded

      const overview = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(overview.totals.enrollments).toBe(2);
      expect(overview.previous?.enrollments).toBe(1);
    });

    it("excludes the instructor's own enrollment and admin enrollments", () => {
      enroll(base.user.id, "2026-06-10T00:00:00.000Z");
      enroll(base.instructor.id, "2026-06-10T00:00:00.000Z");
      enroll(student("admin", schema.UserRole.Admin).id, "2026-06-10T00:00:00.000Z");

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.enrollments).toBe(1);
    });

    it("counts an enrollment from a redeemed team coupon like any other", () => {
      const teamPurchase = purchase(2 * 4999, "2026-06-01T00:00:00.000Z", base.course.id);
      const team = testDb.insert(schema.teams).values({}).returning().get();
      const seat = student("seat");
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "SEAT",
          purchaseId: teamPurchase.id,
          redeemedByUserId: seat.id,
          redeemedAt: "2026-06-02T00:00:00.000Z",
        })
        .run();
      enroll(seat.id, "2026-06-02T00:00:00.000Z");

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.enrollments).toBe(1);
    });

    it("excludes draft courses", () => {
      const draft = testDb
        .insert(schema.courses)
        .values({
          title: "Draft",
          slug: "draft",
          description: "",
          salesCopy: "",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Draft,
        })
        .returning()
        .get();
      enroll(base.user.id, "2026-06-10T00:00:00.000Z", draft.id);

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).totals.enrollments).toBe(0);
    });
  });

  describe("getInstructorOverview — series", () => {
    /** Non-zero points only, as [bucket, value] pairs. */
    function nonZero(points: { bucket: string; value: number }[]) {
      return points.filter((p) => p.value !== 0).map((p) => [p.bucket, p.value]);
    }

    it("30d is daily in UTC, zero-filled from the window's first day through today", () => {
      purchase(100, "2026-06-14T23:59:59.999Z");
      purchase(10, "2026-06-15T00:00:00.000Z");
      purchase(1, "2026-06-15T00:00:00.001Z");

      const { series } = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(series.granularity).toBe("day");
      expect(series.revenue).toHaveLength(31);
      expect(series.revenue[0]).toEqual({ bucket: "2026-05-16", value: 0 });
      expect(series.revenue.at(-1)?.bucket).toBe("2026-06-15");
      expect(nonZero(series.revenue)).toEqual([
        ["2026-06-14", 100],
        ["2026-06-15", 11],
      ]);
      expect(series.enrollments.map((p) => p.bucket)).toEqual(series.revenue.map((p) => p.bucket));
      expect(nonZero(series.enrollments)).toEqual([]);
    });

    it("90d is weekly, buckets starting on Monday UTC", () => {
      // NOW is Monday 2026-06-15. Sunday 06-14 belongs to the week of Monday 06-08.
      purchase(5, "2026-06-14T23:59:59.999Z");
      purchase(7, "2026-06-08T00:00:00.000Z");
      purchase(3, "2026-06-15T00:00:00.000Z");

      const { series } = getInstructorOverview(base.instructor.id, "90d", NOW);

      expect(series.granularity).toBe("week");
      // Window starts Tue 2026-03-17, whose week starts Mon 2026-03-16.
      expect(series.revenue[0].bucket).toBe("2026-03-16");
      expect(series.revenue.at(-1)?.bucket).toBe("2026-06-15");
      expect(series.revenue).toHaveLength(14);
      expect(nonZero(series.revenue)).toEqual([
        ["2026-06-08", 12],
        ["2026-06-15", 3],
      ]);
    });

    it("12m is monthly, split at the first of the month UTC", () => {
      purchase(1, "2026-04-30T23:59:59.999Z");
      purchase(2, "2026-05-01T00:00:00.000Z");

      const { series } = getInstructorOverview(base.instructor.id, "12m", NOW);

      expect(series.granularity).toBe("month");
      expect(series.revenue).toHaveLength(13);
      expect(series.revenue[0].bucket).toBe("2025-06-01");
      expect(series.revenue.at(-1)?.bucket).toBe("2026-06-01");
      expect(nonZero(series.revenue)).toEqual([
        ["2026-04-01", 1],
        ["2026-05-01", 2],
      ]);
    });

    it("all is monthly from the earliest sale or enrollment", () => {
      purchase(9, "2026-03-20T00:00:00.000Z");
      enroll(base.user.id, "2026-02-10T00:00:00.000Z");

      const { series } = getInstructorOverview(base.instructor.id, "all", NOW);

      expect(series.granularity).toBe("month");
      expect(series.revenue.map((p) => p.bucket)).toEqual([
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
      ]);
      expect(nonZero(series.revenue)).toEqual([["2026-03-01", 9]]);
      expect(nonZero(series.enrollments)).toEqual([["2026-02-01", 1]]);
    });

    it("all with no data has no buckets", () => {
      const { series } = getInstructorOverview(base.instructor.id, "all", NOW);

      expect(series.revenue).toEqual([]);
      expect(series.enrollments).toEqual([]);
    });

    it("enrollment series applies the same exclusions as the headline", () => {
      enroll(base.user.id, "2026-06-10T08:00:00.000Z");
      enroll(base.instructor.id, "2026-06-10T09:00:00.000Z");
      enroll(student("admin", schema.UserRole.Admin).id, "2026-06-10T10:00:00.000Z");
      enroll(student("b").id, "2026-06-10T11:00:00.000Z");

      const { series } = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(nonZero(series.enrollments)).toEqual([["2026-06-10", 2]]);
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

  // ─── Overview course performance & engagement headlines (ticket #11) ───

  describe("getInstructorOverview — course performance", () => {
    function course(title: string, status = schema.CourseStatus.Published, instructorId = base.instructor.id) {
      return testDb
        .insert(schema.courses)
        .values({
          title,
          slug: `${title}-${Math.random()}`,
          description: "",
          salesCopy: "",
          instructorId,
          categoryId: base.category.id,
          status,
        })
        .returning()
        .get();
    }

    function enrollAt(courseId: number, enrolledAt: string, completedAt: string | null = null) {
      const u = student(`s-${Math.random()}`);
      testDb.insert(schema.enrollments).values({ userId: u.id, courseId, enrolledAt, completedAt }).run();
      return u;
    }

    function rate(courseId: number, rating: number) {
      const u = student(`r-${Math.random()}`);
      testDb.insert(schema.courseRatings).values({ userId: u.id, courseId, rating }).run();
    }

    it("lists each Published and Archived course with ranged revenue and enrollments and all-time completion and rating", () => {
      const archived = course("Archived Course", schema.CourseStatus.Archived);
      course("Draft Course", schema.CourseStatus.Draft);
      purchase(4999, "2026-06-10T00:00:00.000Z");
      purchase(1000, "2026-01-01T00:00:00.000Z"); // outside 30d
      purchase(2999, "2026-06-01T00:00:00.000Z", archived.id);
      enrollAt(base.course.id, "2026-06-10T00:00:00.000Z", "2026-06-12T00:00:00.000Z");
      enrollAt(base.course.id, "2025-01-01T00:00:00.000Z"); // outside 30d, still counts for completion
      rate(base.course.id, 5);
      rate(base.course.id, 4);

      const rows = getInstructorOverview(base.instructor.id, "30d", NOW).courses;

      expect(rows).toEqual([
        {
          courseId: archived.id,
          title: "Archived Course",
          status: schema.CourseStatus.Archived,
          revenue: 2999,
          enrollments: 0,
          completionRate: null,
          rating: null,
        },
        {
          courseId: base.course.id,
          title: "Test Course",
          status: schema.CourseStatus.Published,
          revenue: 4999,
          enrollments: 1,
          completionRate: 0.5,
          rating: 4.5,
        },
      ]);
    });

    it("is empty for an instructor whose only course is a draft, and omits other instructors' courses", () => {
      const other = student("Other Instructor", schema.UserRole.Instructor);
      course("Theirs", schema.CourseStatus.Published, other.id);
      testDb.update(schema.courses).set({ status: schema.CourseStatus.Draft }).run();
      course("Theirs Too", schema.CourseStatus.Published, other.id);

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).courses).toEqual([]);
      expect(getInstructorOverview(other.id, "30d", NOW).courses.map((r) => r.title)).toEqual(["Theirs Too"]);
    });

    it("averages completion and rating over courses that have data, all-time", () => {
      const second = course("Second");
      course("No Data");
      enrollAt(base.course.id, "2020-01-01T00:00:00.000Z", "2020-02-01T00:00:00.000Z"); // 100%
      enrollAt(second.id, "2026-06-01T00:00:00.000Z"); // 0%, 0.5 avg
      rate(base.course.id, 5);
      rate(base.course.id, 3); // course avg 4
      rate(second.id, 2); // avg of averages → 3

      const { engagement } = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(engagement.averageCompletion).toBe(0.5);
      expect(engagement.averageRating).toBe(3);
    });

    it("averages are null when no course has data", () => {
      const { engagement } = getInstructorOverview(base.instructor.id, "30d", NOW);

      expect(engagement.averageCompletion).toBeNull();
      expect(engagement.averageRating).toBeNull();
    });

    it("counts the instructor's unanswered questions, matching the questions queue", () => {
      const draft = course("Draft", schema.CourseStatus.Draft);
      const lessonOf = (courseId: number) => {
        const mod = testDb.insert(schema.modules).values({ courseId, title: "M", position: 1 }).returning().get();
        return testDb.insert(schema.lessons).values({ moduleId: mod.id, title: "L", position: 1 }).returning().get();
      };
      const ask = (lessonId: number, userId = base.user.id, parentId: number | null = null) =>
        testDb.insert(schema.comments).values({ lessonId, userId, parentId, body: "?" }).returning().get();
      const lesson = lessonOf(base.course.id);
      ask(lesson.id);
      ask(lessonOf(draft.id).id); // the queue does not filter by course status
      const answered = ask(lesson.id);
      ask(lesson.id, base.instructor.id, answered.id);

      expect(getInstructorOverview(base.instructor.id, "30d", NOW).engagement.unansweredQuestions).toBe(2);
    });
  });
});
