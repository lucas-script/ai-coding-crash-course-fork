import { data, Link } from "react-router";
import type { Route } from "./+types/admin.instructors.$instructorId.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getInstructorOverview } from "~/services/analyticsService";
import { parseRange } from "~/lib/analytics-range";
import { adminOverviewAccess } from "~/lib/admin-instructor-overview";
import { InstructorOverviewPanel } from "~/components/analytics/instructor-overview";
import { Button } from "~/components/ui/button";
import { RouteErrorPanel } from "~/components/route-error";

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

      <InstructorOverviewPanel overview={overview} range={range} readOnly />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <RouteErrorPanel
      error={error}
      fallback="An unexpected error occurred while loading instructor analytics."
      copy={{
        403: { message: "Only admins can access this page." },
        404: { message: "Instructor not found." },
      }}
    >
      <div className="flex items-center justify-center gap-3">
        <Link to="/admin/users">
          <Button variant="outline">Manage Users</Button>
        </Link>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </RouteErrorPanel>
  );
}
