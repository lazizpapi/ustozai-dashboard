"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDay, formatNumber } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { VelocityPoint } from "@/lib/compare";

/**
 * How fast a counter is moving, per day, over time.
 *
 * The chart that answers "are they accelerating", which a cumulative total
 * cannot: a running total always slopes upward, so every app looks like it is
 * growing and none of them look like they are slowing down.
 *
 * Each point is a trailing average rather than that day's difference, because
 * both stores publish their totals in batches. A raw daily difference would
 * draw the publishing schedule, not the app.
 *
 * The zero line is always drawn and the axis is never clamped above it. These
 * counters do restate downward, and a chart that can only render growth turns
 * a correction into a flat patch.
 */

const config = {
  perDay: { label: "Per day", color: "var(--chart-line)" },
} satisfies ChartConfig;

interface VelocityChartProps {
  points: VelocityPoint[];
  /** What one unit is, for the tooltip: "installs", "ratings". */
  noun: string;
  emptyNote: string;
  /** Overrides the series colour, so iOS and Play series stay distinguishable. */
  color?: string;
}

export function VelocityChart({ points, noun, emptyNote, color }: VelocityChartProps) {
  const reducedMotion = useReducedMotion();

  if (points.length < 2) {
    return <p className="text-muted-foreground py-10 text-sm">{emptyNote}</p>;
  }

  const stroke = color ?? "var(--color-perDay)";
  const rates = points.map((point) => point.perDay);
  const low = Math.min(0, ...rates);
  const high = Math.max(...rates);
  const pad = Math.max(1, Math.round((high - low) / 10));

  return (
    <ChartContainer config={config} className="h-[240px] w-full">
      <AreaChart data={points} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <defs>
          <linearGradient id={`vel-${noun}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={44}
          tickFormatter={formatDay}
        />
        <YAxis
          domain={[low - (low < 0 ? pad : 0), high + pad]}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(value: number) => formatNumber(Math.round(value))}
        />
        {/* Always present, so a dip toward zero is readable as a dip. */}
        <ReferenceLine y={0} strokeOpacity={0.5} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDay(label as string)}
              formatter={(value) => [formatNumber(value as number), ` ${noun} a day`]}
            />
          }
        />
        <Area
          dataKey="perDay"
          type="monotone"
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#vel-${noun})`}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ChartContainer>
  );
}
