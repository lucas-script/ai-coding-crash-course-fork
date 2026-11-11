import type { ReactNode } from "react";
import type { Range } from "~/lib/analytics-range";
import type { CourseAnalytics } from "~/services/analyticsService";
import {
  OverviewCharts,
  RANGE_LABELS,
  RangeSelector,
  StatTile,
  formatRevenue,
  percentChange,
  formatRate,
  formatRating,
} from "~/components/analytics/instructor-overview";

export { formatRate, formatRating };

/**
 * A titled block on the course analytics page. Later sections (funnel,
 * revenue by country, team seats, charts) are added as more of these.
 */
export function AnalyticsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="mb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-xl font-semibold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Range-driven revenue and enrollments for one course, with the range selector. */
export function CourseRangeStats({
  analytics,
  range,
}: {
  analytics: CourseAnalytics;
  range: Range;
}) {
  const { totals, previous } = analytics;
  const comparisonLabel = previous ? `vs previous ${RANGE_LABELS[range].toLowerCase()}` : undefined;

  return (
    <AnalyticsSection id="course-sales" title="Sales" action={<RangeSelector range={range} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Gross revenue"
          value={formatRevenue(totals.revenue)}
          change={previous ? percentChange(totals.revenue, previous.revenue) : undefined}
          comparisonLabel={comparisonLabel}
        />
        <StatTile
          label="New enrollments"
          value={totals.enrollments.toString()}
          change={previous ? percentChange(totals.enrollments, previous.enrollments) : undefined}
          comparisonLabel={comparisonLabel}
        />
      </div>
    </AnalyticsSection>
  );
}

/** Revenue and enrollments over the selected range — the overview's charts, scoped to one course. */
export function CourseCharts({ analytics, range }: { analytics: CourseAnalytics; range: Range }) {
  return (
    <AnalyticsSection
      id="course-trends"
      title="Over time"
      description={`${RANGE_LABELS[range]} — follows the selected range.`}
    >
      <OverviewCharts series={analytics.series} />
    </AnalyticsSection>
  );
}

/** All-time completion, activation, and rating for one course. */
export function CourseEngagementStats({ analytics }: { analytics: CourseAnalytics }) {
  const { totals } = analytics;
  return (
    <AnalyticsSection
      id="course-engagement"
      title="Engagement"
      description="All time — not affected by the selected range."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Completion rate (all time)" value={formatRate(totals.completionRate)} />
        <StatTile label="Activation rate (all time)" value={formatRate(totals.activationRate)} />
        <StatTile label="Average rating (all time)" value={formatRating(totals.rating)} />
      </div>
    </AnalyticsSection>
  );
}
