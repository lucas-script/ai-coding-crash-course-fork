import type { ReactNode } from "react";
import type { Range } from "~/lib/analytics-range";
import type { CourseAnalytics } from "~/services/analyticsService";
import type { SalesSlice } from "~/services/analyticsService";
import { Card, CardContent } from "~/components/ui/card";
import {
  RANGE_LABELS,
  RangeSelector,
  StatTile,
  formatRevenue,
  percentChange,
} from "~/components/analytics/instructor-overview";

/** A 0–1 rate as a whole percent, or "—" when there is nothing to divide by. */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Average stars to one decimal, or "—" with no ratings. */
export function formatRating(rating: number | null): string {
  return rating === null ? "—" : `${rating.toFixed(1)} / 5`;
}

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

// ─── Revenue by country and team seats (ticket #9) ───

/** "Last 30 days" / "All time". */
function periodLabel(range: Range): string {
  return range === "all" ? RANGE_LABELS.all : `Last ${RANGE_LABELS[range]}`;
}

/** "$12.00 · 3" — a slice's revenue and purchase count, or "—" when empty. */
function formatSlice(slice: SalesSlice): string {
  return slice.purchases === 0 ? "—" : `${formatRevenue(slice.revenue)} · ${slice.purchases}`;
}

/** Range-driven revenue per country, split into full price, PPP, and team purchases. */
export function CourseRevenueByCountry({
  analytics,
  range,
}: {
  analytics: CourseAnalytics;
  range: Range;
}) {
  const rows = analytics.revenueByCountry;
  return (
    <AnalyticsSection
      id="course-countries"
      title="Revenue by country"
      description={`${periodLabel(range)} · PPP = individual purchases below list price. Cells show revenue · purchases.`}
    >
      {rows.length === 0 ? (
        <Card className="py-8">
          <CardContent className="text-center text-sm text-muted-foreground">
            No purchases in this period.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto py-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Country</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Revenue</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Purchases</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Full price</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">PPP</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Team</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.country} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">{row.country}</th>
                  <td className="px-4 py-3 text-right tabular-nums">{formatRevenue(row.revenue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.purchases}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatSlice(row.fullPrice)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatSlice(row.ppp)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatSlice(row.team)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AnalyticsSection>
  );
}

/** Team seats sold vs redeemed for team purchases made in the range. */
export function CourseTeamSeats({ analytics, range }: { analytics: CourseAnalytics; range: Range }) {
  const { teamSeats } = analytics;
  return (
    <AnalyticsSection
      id="course-team-seats"
      title="Team seats"
      description={`Team purchases made ${range === "all" ? "at any time" : `in the last ${RANGE_LABELS[range]}`}; redemptions counted to date.`}
    >
      {teamSeats.purchases === 0 ? (
        <Card className="py-8">
          <CardContent className="text-center text-sm text-muted-foreground">
            No team purchases in this period.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Team purchases" value={teamSeats.purchases.toString()} />
          <StatTile label="Seats sold" value={teamSeats.sold.toString()} />
          <StatTile
            label="Seats redeemed"
            value={`${teamSeats.redeemed} of ${teamSeats.sold} (${formatRate(teamSeats.redeemed / teamSeats.sold)})`}
          />
        </div>
      )}
    </AnalyticsSection>
  );
}
