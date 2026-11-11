import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import type { Granularity, SeriesPoint } from "~/lib/analytics-range";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short axis label for a `YYYY-MM-DD` bucket key, read in UTC. */
export function formatBucket(bucket: string, granularity: Granularity): string {
  const [year, month, day] = bucket.split("-").map(Number);
  const name = MONTHS[month - 1];
  return granularity === "month" ? `${name} ${String(year).slice(2)}` : `${name} ${day}`;
}

/** Long tooltip label for a bucket key: names the whole day, week, or month. */
export function formatBucketLong(bucket: string, granularity: Granularity): string {
  const [year, month, day] = bucket.split("-").map(Number);
  const name = MONTHS[month - 1];
  switch (granularity) {
    case "day":
      return `${name} ${day}, ${year}`;
    case "week":
      return `Week of ${name} ${day}, ${year}`;
    case "month":
      return `${name} ${year}`;
  }
}

/**
 * One metric over time as a bar chart in a card. Bars are UTC buckets of
 * `granularity`; `formatValue` renders values on the axis and tooltip. When
 * every bucket is zero (or there are none) it shows `emptyMessage` instead.
 * `color` is a CSS color, typically a `--chart-N` theme token.
 */
export function TimeSeriesChart({
  title,
  points,
  granularity,
  formatValue,
  formatAxisValue = formatValue,
  emptyMessage,
  color = "var(--chart-1)",
}: {
  title: string;
  points: SeriesPoint[];
  granularity: Granularity;
  formatValue: (value: number) => string;
  /** Compact y-axis tick format; defaults to `formatValue`. */
  formatAxisValue?: (value: number) => string;
  emptyMessage: string;
  color?: string;
}) {
  const config = { value: { label: title, color } } satisfies ChartConfig;
  const empty = points.every((point) => point.value === 0);

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {empty ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-56 w-full">
            <BarChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={16}
                tickFormatter={(bucket: string) => formatBucket(bucket, granularity)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width="auto"
                allowDecimals={false}
                tickFormatter={(value: number) => formatAxisValue(value)}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      formatBucketLong(String(payload?.[0]?.payload?.bucket ?? ""), granularity)
                    }
                    formatter={(value) => (
                      <div className="flex w-full items-center justify-between gap-4">
                        <span className="text-muted-foreground">{title}</span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatValue(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
