"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { dayTicks } from "@/lib/compare";
import { formatDay, formatNumber } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { FollowerPoint } from "@/lib/db/queries";

/**
 * The follower count itself over time, not the change in it.
 *
 * The growth page already answers "how many did we gain this week". This
 * answers the different question people actually ask of a single platform:
 * what does the curve look like, and is it bending.
 *
 * Two decisions worth naming.
 *
 * The axis does not start at zero. These are large counts that move by
 * fractions of a percent, so a zero-based axis renders every real change as a
 * flat line. The tradeoff is that the slope exaggerates, which is why the
 * caption says the axis is zoomed rather than leaving it to be discovered.
 *
 * A flat stretch is information. When a platform stops answering, the reading
 * stops advancing and the line goes horizontal, which is the shape of a
 * collection failure rather than of a plateau in interest. That is what the
 * freshness line beside the chart is for.
 */

const config = {
  followers: { label: "Followers", color: "var(--series-ios)" },
} satisfies ChartConfig;

interface FollowerChartProps {
  points: FollowerPoint[];
  /** Whether the platform reports an exact figure. YouTube does not. */
  isExact: boolean;
}

export function FollowerChart({ points, isExact }: FollowerChartProps) {
  const reducedMotion = useReducedMotion();

  if (points.length < 2) {
    return (
      <p className="text-muted-foreground py-10 text-sm">
        Not enough readings yet to draw a line. The next scheduled poll adds
        one.
      </p>
    );
  }

  const counts = points.map((point) => point.followers);
  const low = Math.min(...counts);
  const high = Math.max(...counts);
  // A tenth of the observed range as padding, so the line is not welded to the
  // frame; a flat series gets a nominal band instead of a zero-height domain.
  const pad = Math.max(1, Math.round((high - low) / 10));

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-[260px] w-full">
        <AreaChart
          data={points}
          margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
        >
          <defs>
            {/* The fill is what makes a near-flat line read as a quantity
                rather than as a stray stroke across the panel. */}
            <linearGradient id="followerFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-followers)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-followers)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="at"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            // One tick per day. Readings are far more frequent than daily and
            // every label is a date, so evenly spaced ticks repeat themselves.
            ticks={dayTicks(points.map((point) => point.at))}
            tickFormatter={formatDay}
          />
          <YAxis
            domain={[low - pad, high + pad]}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatNumber(Math.round(value))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatDay(payload?.[0]?.payload?.at as string)
                }
                formatter={(value) => [
                  `${isExact ? "" : "≈"}${formatNumber(value as number)}`,
                  " followers",
                ]}
              />
            }
          />
          <Area
            dataKey="followers"
            type="monotone"
            stroke="var(--color-followers)"
            strokeWidth={2}
            fill="url(#followerFill)"
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ChartContainer>

      <p className="text-muted-foreground text-xs">
        The axis is zoomed to the range actually observed, so small changes are
        visible and the slope reads steeper than the percentage change.
        {isExact
          ? " A flat stretch means the count did not move."
          : " YouTube rounds this figure, so it steps rather than climbs."}
      </p>
    </div>
  );
}
