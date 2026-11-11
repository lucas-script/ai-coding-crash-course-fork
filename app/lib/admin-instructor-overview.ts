import { UserRole } from "~/db/schema";

export type AdminOverviewAccess = "ok" | "forbidden" | "not-found";

/**
 * May this viewer see the admin analytics overview for this target user?
 * Non-admins are forbidden before the target is considered, so the page never
 * reveals which ids exist; admins get not-found for anyone but an instructor.
 * Roles are undefined when the user doesn't exist.
 */
export function adminOverviewAccess(
  viewerRole: UserRole | undefined,
  targetRole: UserRole | undefined
): AdminOverviewAccess {
  if (viewerRole !== UserRole.Admin) return "forbidden";
  if (targetRole !== UserRole.Instructor) return "not-found";
  return "ok";
}
