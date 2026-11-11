import { TrendingDown } from "lucide-react";
import type { CourseFunnel } from "~/services/analyticsService";
import { AnalyticsSection } from "~/components/analytics/course-analytics";
import { formatRate } from "~/components/analytics/instructor-overview";
import { cn } from "~/lib/utils";

/** A 0–1 drop as whole percentage points, e.g. "−43 pp". */
function formatDrop(drop: number): string {
  return `−${Math.round(drop * 100)} pp`;
}

/**
 * All-time lesson drop-off funnel: each lesson's completion as a share of all
 * enrollments, grouped by module, with the biggest drop-off highlighted.
 */
export function CourseFunnelSection({ funnel }: { funnel: CourseFunnel }) {
  const lessonCount = funnel.modules.reduce((n, m) => n + m.lessons.length, 0);
  const biggest = funnel.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.id === funnel.biggestDropLessonId);

  return (
    <AnalyticsSection
      id="course-funnel"
      title="Lesson drop-off (all time)"
      description="Share of all enrollments that completed each lesson — not affected by the selected range."
    >
      {lessonCount === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          This course has no lessons yet.
        </p>
      ) : funnel.enrollments === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No students have enrolled yet, so there is no drop-off to show.
        </p>
      ) : (
        <div className="space-y-6 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Based on {funnel.enrollments} enrollment{funnel.enrollments === 1 ? "" : "s"}.{" "}
            {biggest && biggest.dropFromPrevious !== null
              ? `Biggest drop-off: “${biggest.title}” (${formatDrop(biggest.dropFromPrevious)} vs the previous lesson).`
              : "No lesson has lower completion than the one before it."}
          </p>
          {funnel.modules.map((mod) => (
            <div key={mod.id}>
              <h3 className="mb-2 text-sm font-semibold">{mod.title}</h3>
              <ol className="space-y-2">
                {mod.lessons.map((lesson) => {
                  const pct = Math.round((lesson.completionRate ?? 0) * 100);
                  return (
                    <li
                      key={lesson.id}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 sm:grid-cols-[minmax(0,14rem)_1fr_auto]",
                        lesson.isBiggestDrop && "bg-destructive/10 ring-1 ring-destructive/40"
                      )}
                    >
                      <span className="truncate text-sm" title={lesson.title}>
                        {lesson.title}
                      </span>
                      <div
                        className="col-span-2 h-2 overflow-hidden rounded-full bg-muted sm:col-span-1 sm:row-start-1 sm:col-start-2"
                        role="img"
                        aria-label={`${pct}% completed`}
                      >
                        <div
                          className={cn("h-full rounded-full", lesson.isBiggestDrop ? "bg-destructive" : "bg-primary")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="row-start-1 col-start-2 flex items-center justify-end gap-2 text-sm tabular-nums sm:col-start-3">
                        {lesson.isBiggestDrop && lesson.dropFromPrevious !== null && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                            <TrendingDown className="size-3" aria-hidden />
                            Biggest drop {formatDrop(lesson.dropFromPrevious)}
                          </span>
                        )}
                        {formatRate(lesson.completionRate)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </AnalyticsSection>
  );
}
