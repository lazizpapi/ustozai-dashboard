"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDay, formatNumber } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Takings per day.
 *
 * The axis starts at zero, unlike the follower chart. A revenue chart zoomed
 * to its own range exaggerates every wobble into a cliff, and money is the
 * figure people are least willing to re-read carefully once they have taken
 * an impression from the shape.
 */

const config = {
  amount: { label: "Takings", color: "var(--chart-line)" },
} satisfies ChartConfig;

export function RevenueChart({ points }: { points: { date: string; amount: number }[] }) {
  const reducedMotion = useReducedMotion();

  if (points.length < 2) {
    return (
      <p className="text-muted-foreground py-10 text-sm">
        Not enough days recorded yet to draw a line.
      </p>
    );
  }

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <AreaChart data={points} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-amount)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-amount)" stopOpacity={0.02} />
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
          // Zero-based on purpose. See the note above.
          domain={[0, "auto"]}
          tickLine={false}
          axisLine={false}
          width={72}
          tickFormatter={(value: number) => formatNumber(Math.round(value))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => formatDay(label as string)}
              // Named in the tooltip, not on the axis: a currency repeated
              // down every tick crowds the scale it is meant to explain.
              formatter={(value) => [`${formatNumber(value as number)} UZS`, " taken"]}
            />
          }
        />
        <Area
          dataKey="amount"
          type="monotone"
          stroke="var(--color-amount)"
          strokeWidth={2.5}
          fill="url(#revenueFill)"
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ChartContainer>
  );
}
