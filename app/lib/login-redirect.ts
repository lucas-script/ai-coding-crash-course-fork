import { UserRole } from "~/db/schema";

// Only same-origin relative paths are allowed; "//host" and "/\host" are
// treated by browsers as protocol-relative URLs to another origin.
function isSafeRedirect(redirectTo: string | null): redirectTo is string {
  return (
    !!redirectTo &&
    redirectTo.startsWith("/") &&
    !redirectTo.startsWith("//") &&
    !redirectTo.startsWith("/\\")
  );
}

export function getLoginDestination(role: UserRole, redirectTo: string | null): string {
  if (isSafeRedirect(redirectTo)) return redirectTo;
  return role === UserRole.Instructor ? "/instructor" : "/courses";
}
