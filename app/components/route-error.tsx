import type { ReactNode } from "react";
import { isRouteErrorResponse } from "react-router";
import { AlertTriangle } from "lucide-react";

type ErrorCopy = { title: string; message: string };

const STATUS_COPY: Record<number, ErrorCopy> = {
  401: { title: "Sign in required", message: "Please select a user from the DevUI panel." },
  403: { title: "Access denied", message: "You don't have permission to view this page." },
  404: { title: "Not found", message: "This page doesn't exist." },
};

/**
 * Centered error panel for a route's ErrorBoundary. A thrown response's
 * string data wins; otherwise the copy comes from `copy` for that status,
 * then the defaults above. `fallback` covers non-response errors.
 */
export function RouteErrorPanel({
  error,
  fallback,
  copy = {},
  children,
}: {
  error: unknown;
  /** Message for unexpected (non-response) errors. */
  fallback: string;
  /** Per-status overrides of the default title/message. */
  copy?: Partial<Record<number, Partial<ErrorCopy>>>;
  /** Action buttons under the message. */
  children: ReactNode;
}) {
  let title = "Something went wrong";
  let message = fallback;

  if (isRouteErrorResponse(error)) {
    const base = STATUS_COPY[error.status] ?? {
      title: `Error ${error.status}`,
      message: error.statusText,
    };
    const override = copy[error.status];
    title = override?.title ?? base.title;
    message =
      typeof error.data === "string" ? error.data : (override?.message ?? base.message);
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        {children}
      </div>
    </div>
  );
}
