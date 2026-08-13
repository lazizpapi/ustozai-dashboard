"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDay } from "@/lib/format";
import type { DailyDownloads, DailyInstalls } from "@/lib/db/queries";

/**
 * Daily installs, both platforms on one axis.
 *
 * One y axis, never two. A dual-scale chart is the single most misleading chart
 * form there is: the crossing point is an artifact of the two scales rather
 * than anything in the data. Both series are counts of the same thing, so they
 * share a scale honestly.
 *
 * The two hues are slots 1 and 2 of a validated categorical palette, checked
 * against this exact surface in both themes. A legend is always present, since
 * identity must never rest on colour alone.
 *
 * The two numbers are not quite the same measurement and the caption says so:
 * Apple reports first-time downloads for a day, while the Android figure is the
 * change in Play's cumulative "installs by unique users" between two readings.
 */

const config = {
  ios: { label: "App Store", color: "var(--series-ios)" },
  android: { label: "Google Play", color: "var(--series-android)" },
} satisfies ChartConfig;

interface DownloadsChartProps {
  ios: DailyDownloads[];
  android: DailyInstalls[];
  /** Fill the parent instead of a fixed height. Used by the wall display. */
  fill?: boolean;
  /** Drop the explanatory caption where space is scarce and nobody can read it. */
  compact?: boolean;
}

export function DownloadsChart({ ios, android, fill, compact }: DownloadsChartProps) {
  const byDate = new Map<string, { date: string; ios: number | null; android: number | null }>();

  for (const row of ios) {
    byDate.set(row.date, { date: row.date, ios: row.downloads, android: null });
  }
  for (const row of android) {
    const existing = byDate.get(row.date);
    if (existing) existing.android = row.installs;
    else byDate.set(row.date, { date: row.date, ios: null, android: row.installs });
  }

  const data = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-sm">
        No download history yet. Android needs two daily snapshots before a delta
        exists, and iOS needs an App Store Connect key.
      </p>
    );
  }

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col gap-2" : "space-y-2"}>
      <ChartContainer config={config} className={fill ? "h-full w-full" : "h-[300px] w-full"}>
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
            tickFormatter={formatDay}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => value.toLocaleString("en-US")}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatDay(payload?.[0]?.payload?.date as string)
                }
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="ios"
            name="App Store"
            type="monotone"
            stroke="var(--color-ios)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            dataKey="android"
            name="Google Play"
            type="monotone"
            stroke="var(--color-android)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>

      {compact ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Both series are dated to the day they describe and are never live. App Store
          figures are first-time downloads from Sales and Trends, published a day
          behind. Google Play figures are the day-to-day change in a cumulative
          installs-by-unique-users total, so they are close to, but not identical
          with, Apple&apos;s definition.
        </p>
      )}
    </div>
  );
}
