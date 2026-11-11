import { Link, data } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/instructor.$courseId.analytics";
import { getCourseById } from "~/services/courseService";
import { getCourseAnalytics } from "~/services/analyticsService";
import { parseRange } from "~/lib/analytics-range";
import { requireInstructorOrAdmin, requireStaff } from "~/lib/access.server";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  CourseCharts,
  CourseEngagementStats,
  CourseRangeStats,
  CourseRevenueByCountry,
  CourseTeamSeats,
} from "~/components/analytics/course-analytics";
import { CourseFunnelSection } from "~/components/analytics/course-funnel";
import { RouteErrorPanel } from "~/components/route-error";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `Analytics for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  // Reject signed-out users (401) and non-staff roles (403) before touching the
  // course, so they can't probe which course ids exist.
  await requireInstructorOrAdmin(request);

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  // Instructors may only see their own courses; admins see any.
  await requireStaff(request, courseId);

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  // Null for a Draft course: Drafts are excluded from analytics.
  const analytics = getCourseAnalytics(courseId, range, new Date());

  return { course: { id: course.id, title: course.title }, range, analytics };
}

export default function CourseAnalyticsPage({ loaderData }: Route.ComponentProps) {
  const { course, range, analytics } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <Link
        to={`/instructor/${course.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to course editor
      </Link>

      <h1 className="mb-8 text-3xl font-bold">{course.title}: Analytics</h1>

      {analytics ? (
        <>
          <CourseRangeStats analytics={analytics} range={range} />
          <CourseCharts analytics={analytics} range={range} />
          <CourseEngagementStats analytics={analytics} />
          <CourseFunnelSection funnel={analytics.funnel} />
          <CourseRevenueByCountry analytics={analytics} range={range} />
          <CourseTeamSeats analytics={analytics} range={range} />
        </>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Draft courses aren't included in analytics; publish to start tracking.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <RouteErrorPanel
      error={error}
      fallback="An unexpected error occurred while loading course analytics."
      copy={{
        403: { message: "You don't have permission to view this course's analytics." },
        404: { title: "Course not found", message: "This course doesn't exist." },
      }}
    >
      <Link to="/instructor">
        <Button variant="outline">Back to My Courses</Button>
      </Link>
    </RouteErrorPanel>
  );
}
