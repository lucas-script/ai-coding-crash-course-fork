import { Link, data, isRouteErrorResponse } from "react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Route } from "./+types/instructor.$courseId.analytics";
import { getCourseById } from "~/services/courseService";
import { getCourseAnalytics, parseRange } from "~/services/analyticsService";
import { requireStaff } from "~/lib/access.server";
import { Button } from "~/components/ui/button";
import {
  CourseCharts,
  CourseEngagementStats,
  CourseRangeStats,
} from "~/components/analytics/course-analytics";
import { CourseFunnelSection } from "~/components/analytics/course-funnel";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `Analytics for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  // The course's own instructor or any admin: 401 signed out, 403 otherwise.
  await requireStaff(request, courseId);

  const range = parseRange(new URL(request.url).searchParams.get("range"));
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

      {/* Sections stack here; later tickets add charts, funnel, countries, seats. */}
      <CourseRangeStats analytics={analytics} range={range} />
      <CourseCharts analytics={analytics} range={range} />
      <CourseEngagementStats analytics={analytics} />
      <CourseFunnelSection funnel={analytics.funnel} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to view this course's analytics.";
    } else if (error.status === 404) {
      title = "Course not found";
      message = typeof error.data === "string" ? error.data : "This course doesn't exist.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/instructor">
          <Button variant="outline">Back to My Courses</Button>
        </Link>
      </div>
    </div>
  );
}
