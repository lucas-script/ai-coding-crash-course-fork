import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowDownRight, ArrowUpRight, MessageCircleQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import { RANGES, type Range } from "~/lib/analytics-range";
import { CourseStatus } from "~/db/schema";
import type {
  CoursePerformanceRow,
  InstructorOverview,
  OverviewEngagement,
  OverviewSeries,
} from "~/services/analyticsService";
import { TimeSeriesChart } from "~/components/analytics/time-series-chart";

export const RANGE_LABELS: Record<Range, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
  all: "All time",
};

/** Revenue in cents as currency; unlike formatPrice, 0 reads "$0.00", not "Free". */
export function formatRevenue(cents: number): string {
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

/** A 0–1 rate as a whole percent, or "—" when there is nothing to divide by. */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Average stars to one decimal, or "—" with no ratings. */
export function formatRating(rating: number | null): string {
  return rating === null ? "—" : `${rating.toFixed(1)} / 5`;
}

/** Percent change from `previous` to `current`, or null when it can't be computed. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Range picker that writes the `range` search param, keeping other params. */
export function RangeSelector({ range }: { range: Range }) {
  const [searchParams] = useSearchParams();

  return (
    <div className="inline-flex rounded-lg border bg-muted p-1" role="group" aria-label="Time range">
      {RANGES.map((value) => {
        const params = new URLSearchParams(searchParams);
        params.set("range", value);
        const active = value === range;
        return (
          <Link
            key={value}
            to={`?${params.toString()}`}
            preventScrollReset
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {RANGE_LABELS[value]}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A headline number. `change` is a percent, null for "no comparable value"
 * (shown as "—"), or undefined to omit the comparison line (e.g. all time).
 */
export function StatTile({
  label,
  value,
  change,
  comparisonLabel,
  note,
}: {
  label: string;
  value: string;
  change?: number | null;
  comparisonLabel?: string;
  /** Secondary line shown when there is no comparison (e.g. "All time" or a link). */
  note?: ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {change !== undefined && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {change === null ? (
              <span>—</span>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center font-medium",
                  change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {change >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                {Math.abs(change).toFixed(0)}%
              </span>
            )}
            {comparisonLabel && <span>{comparisonLabel}</span>}
          </p>
        )}
        {change === undefined && note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}

/** Whole dollars for chart axes, e.g. 499900 → "$4,999". */
export function formatRevenueAxis(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Revenue and enrollments-over-time charts for an `OverviewSeries`. Reusable
 * for any scope (instructor, single course) that produces one.
 */
export function OverviewCharts({ series }: { series: OverviewSeries }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <TimeSeriesChart
        title="Revenue"
        points={series.revenue}
        granularity={series.granularity}
        formatValue={formatRevenue}
        formatAxisValue={formatRevenueAxis}
        emptyMessage="No sales in this period"
        color="var(--chart-1)"
      />
      <TimeSeriesChart
        title="Enrollments"
        points={series.enrollments}
        granularity={series.granularity}
        formatValue={(n) => n.toLocaleString("en-US")}
        emptyMessage="No enrollments in this period"
        color="var(--chart-2)"
      />
    </div>
  );
}

/**
 * Analytics overview for one instructor: range selector, headline tiles, charts,
 * and course table. Self-contained, so instructor and admin routes can both
 * render it; `readOnly` (the admin view) drops the instructor's own calls to action.
 */
export function InstructorOverviewPanel({
  overview,
  range,
  readOnly = false,
}: {
  overview: InstructorOverview;
  range: Range;
  readOnly?: boolean;
}) {
  const { totals, previous } = overview;
  const comparisonLabel = previous ? `vs previous ${RANGE_LABELS[range].toLowerCase()}` : undefined;

  return (
    <section aria-labelledby="analytics-overview-heading" className="mb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="analytics-overview-heading" className="text-xl font-semibold">
          Overview
        </h2>
        <RangeSelector range={range} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Gross revenue"
          value={formatRevenue(totals.revenue)}
          change={previous ? percentChange(totals.revenue, previous.revenue) : undefined}
          comparisonLabel={comparisonLabel}
        />
        <StatTile
          label="New enrollments"
          value={totals.enrollments.toLocaleString("en-US")}
          change={previous ? percentChange(totals.enrollments, previous.enrollments) : undefined}
          comparisonLabel={comparisonLabel}
        />
        <EngagementTiles engagement={overview.engagement} readOnly={readOnly} />
      </div>
      <OverviewCharts series={overview.series} />
      <CoursePerformanceTable rows={overview.courses} readOnly={readOnly} />
    </section>
  );
}

/**
 * All-time average completion and rating, plus the unanswered-questions count.
 * The instructor's view links the count to their questions queue; the admin
 * view doesn't, because an admin's queue lists every instructor's questions.
 */
function EngagementTiles({
  engagement,
  readOnly,
}: {
  engagement: OverviewEngagement;
  readOnly: boolean;
}) {
  const queueLink = (
    <Link
      to="/instructor/questions"
      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
    >
      <MessageCircleQuestion className="size-3" />
      Open questions queue
    </Link>
  );
  return (
    <>
      <StatTile label="Avg. completion" value={formatRate(engagement.averageCompletion)} note="All time" />
      <StatTile label="Avg. rating" value={formatRating(engagement.averageRating)} note="All time" />
      <StatTile
        label="Unanswered questions"
        value={engagement.unansweredQuestions.toLocaleString("en-US")}
        note={readOnly ? "In this instructor's queue" : queueLink}
      />
    </>
  );
}

const STATUS_LABELS: Record<CourseStatus, string> = {
  [CourseStatus.Published]: "Published",
  [CourseStatus.Draft]: "Draft",
  [CourseStatus.Archived]: "Archived",
};

/**
 * Per-course figures for Published and Archived courses; each title links to
 * the course's analytics page. With no Published course (Archived rows are
 * still listed), the instructor is prompted to publish one; the read-only
 * admin view shows a neutral message instead.
 */
export function CoursePerformanceTable({
  rows,
  readOnly = false,
}: {
  rows: CoursePerformanceRow[];
  readOnly?: boolean;
}) {
  const hasPublished = rows.some((row) => row.status === CourseStatus.Published);
  return (
    <Card className="mt-4 gap-4">
      <CardHeader>
        <CardTitle>Course performance</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasPublished && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {readOnly
              ? "This instructor has no published courses."
              : "No published courses yet. Publish a course to start tracking how it performs here."}
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Course</th>
                  <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                  <th className="py-2 pr-4 text-right font-medium">Enrollments</th>
                  <th className="py-2 pr-4 text-right font-medium">Completion</th>
                  <th className="py-2 text-right font-medium">Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.courseId} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <Link
                        to={`/instructor/${row.courseId}/analytics`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.status !== CourseStatus.Published && (
                        <span className="ml-2 text-xs text-muted-foreground">{STATUS_LABELS[row.status]}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatRevenue(row.revenue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.enrollments.toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatRate(row.completionRate)}</td>
                    <td className="py-2 text-right tabular-nums">{formatRating(row.rating)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
