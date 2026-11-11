import { Link, useSearchParams } from "react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import { RANGES, type Range } from "~/lib/analytics-range";
import type { InstructorOverview, OverviewSeries } from "~/services/analyticsService";
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
}: {
  label: string;
  value: string;
  change?: number | null;
  comparisonLabel?: string;
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
 * Analytics overview for one instructor: range selector, headline tiles, and charts.
 * Read-only and self-contained, so instructor and admin routes can both render it.
 */
export function InstructorOverviewPanel({
  overview,
  range,
}: {
  overview: InstructorOverview;
  range: Range;
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>
      <OverviewCharts series={overview.series} />
    </section>
  );
}
