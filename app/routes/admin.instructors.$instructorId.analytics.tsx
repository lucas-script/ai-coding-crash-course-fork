import { data, isRouteErrorResponse, Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/admin.instructors.$instructorId.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getInstructorOverview, parseRange } from "~/services/analyticsService";
import { adminOverviewAccess } from "~/lib/admin-instructor-overview";
import { InstructorOverviewPanel } from "~/components/analytics/instructor-overview";
import { Button } from "~/components/ui/button";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.instructor.name ?? "Instructor";
  return [
    { title: `${name} Analytics — Cadence` },
    { name: "description", content: `Analytics overview for ${name}` },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view instructor analytics.", {
      status: 401,
    });
  }

  const instructorId = Number(params.instructorId);
  const target = Number.isInteger(instructorId) ? getUserById(instructorId) : undefined;

  switch (adminOverviewAccess(getUserById(currentUserId)?.role, target?.role)) {
    case "forbidden":
      throw data("Only admins can access this page.", { status: 403 });
    case "not-found":
      throw data("Instructor not found.", { status: 404 });
  }

  const range = parseRange(new URL(request.url).searchParams.get("range"));
  const overview = getInstructorOverview(instructorId, range, new Date());

  return { instructor: { id: target!.id, name: target!.name }, overview, range };
}

export default function AdminInstructorAnalytics({ loaderData }: Route.ComponentProps) {
  const { instructor, overview, range } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/admin/users" className="hover:text-foreground">
          Users
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{instructor.name}</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">{instructor.name}</h1>
        <p className="mt-1 text-muted-foreground">Instructor analytics (read-only)</p>
      </div>

      <InstructorOverviewPanel overview={overview} range={range} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading instructor analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "Only admins can access this page.";
    } else if (error.status === 404) {
      title = "Not found";
      message = typeof error.data === "string" ? error.data : "Instructor not found.";
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
        <div className="flex items-center justify-center gap-3">
          <Link to="/admin/users">
            <Button variant="outline">Manage Users</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
