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
import { formatDay, formatRating } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { DailyPoint } from "@/lib/compare";

/**
 * The store rating over time, both stores on one axis.
 *
 * A rating is the one figure on a store page that looks static and is not. It
 * is a running mean over every rating ever left, so it moves slowly and only
 * in one direction at a time, and a single number can never say which. This
 * says which.
 *
 * Both series share one axis, which is honest here in a way it is not for
 * counts: these are the same measurement on the same 1 to 5 scale. The two
 * lines are the accent and the neutral rather than two hues, which reads as a
 * hierarchy the data does not have, so the legend is not decoration. Identity
 * rests on the label.
 *
 * The axis is zoomed to the range observed and clamped inside 1 to 5. A rating
 * that moves from 4.76 to 4.71 is a real movement worth seeing, and on a full
 * 1 to 5 axis it is a flat line; the caption says the axis is zoomed rather
 * than leaving the exaggerated slope to be discovered.
 */

const config = {
  ios: { label: "App Store", color: "var(--chart-line)" },
  android: { label: "Google Play", color: "var(--chart-line-secondary)" },
} satisfies ChartConfig;

interface RatingChartProps {
  ios: DailyPoint[];
  android: DailyPoint[];
}

/** A day's readings from both stores, with a gap where a store said nothing. */
function merge(ios: DailyPoint[], android: DailyPoint[]) {
  const byDate = new Map<string, { date: string; ios: number | null; android: number | null }>();

  const put = (points: DailyPoint[], key: "ios" | "android") => {
    for (const point of points) {
      const row = byDate.get(point.date) ?? { date: point.date, ios: null, android: null };
      row[key] = point.value;
      byDate.set(point.date, row);
    }
  };

  put(ios, "ios");
  put(android, "android");

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function RatingChart({ ios, android }: RatingChartProps) {
  const reducedMotion = useReducedMotion();

  // Two readings on one store is enough for a line. One reading on each is
  // two dots that share no day, which draws nothing.
  if (ios.length < 2 && android.length < 2) {
    return (
      <p className="text-muted-foreground py-10 text-sm">
        Not enough readings yet to draw a line. Two days of history draws the
        first segment.
      </p>
    );
  }

  const rows = merge(ios, android);
  const values = rows.flatMap((row) =>
    [row.ios, row.android].filter((value): value is number => value !== null),
  );
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A tenth of the observed range, floored at a hundredth so a rating that
  // held steady all month still gets a band rather than a zero-height domain.
  const pad = Math.max(0.01, (high - low) / 10);

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-[260px] w-full">
        <LineChart data={rows} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDay}
          />
          <YAxis
            // Clamped to the scale the figure actually lives on: padding must
            // never suggest a 5.04 or a 0.9 is possible.
            domain={[Math.max(1, low - pad), Math.min(5, high + pad)]}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => value.toFixed(2)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDay(label as string)}
                formatter={(value, name) => [
                  formatRating(value as number),
                  ` ${config[name as keyof typeof config]?.label ?? name}`,
                ]}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="ios"
            name="ios"
            type="monotone"
            stroke="var(--color-ios)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            // A day a store did not answer is a gap in what we know, not a
            // drop in the rating, so the line breaks rather than bridging it.
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
          <Line
            dataKey="android"
            name="android"
            type="monotone"
            stroke="var(--color-android)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ChartContainer>

      <p className="text-muted-foreground text-xs">
        The axis is zoomed to the range actually observed, so a movement of a
        few hundredths is visible and the slope reads steeper than it is. A
        rating is a running mean over every rating ever left, so it moves
        slowly: a flat stretch is the normal state, not a collection failure.
      </p>
    </div>
  );
}
