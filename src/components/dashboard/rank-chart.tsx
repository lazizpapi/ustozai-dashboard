"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { dayTicks } from "@/lib/compare";
import { formatDay } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import type { RankPoint } from "@/lib/db/queries";

/**
 * Chart position over time.
 *
 * The y axis is reversed on purpose. Rank 1 is the best possible outcome and
 * belongs at the top; drawn on an ordinary axis, a climb from #24 to #21 slopes
 * downward and reads as bad news at a glance. This is the single easiest thing
 * to get backwards on this page.
 *
 * Gaps are also meaningful. A null rank means the poll succeeded and the app
 * was outside the feed, which is a real state and not missing data, so the line
 * breaks rather than interpolating across it and the caption says why.
 */

const config = {
  rank: { label: "Rank", color: "var(--chart-line)" },
} satisfies ChartConfig;

interface RankChartProps {
  points: RankPoint[];
  /** Height override, so a view that owns its vertical space can fill it. */
  className?: string;
}

export function RankChart({ points, className }: RankChartProps) {
  const reducedMotion = useReducedMotion();

  if (points.length === 0) {
    return (
      <p className="text-muted-foreground py-12 text-sm">
        No position history yet. The first reading lands on the next scheduled run.
      </p>
    );
  }

  const data = points.map((point) => ({
    capturedAt: point.capturedAt,
    rank: point.rank,
  }));

  const feedSize = points.at(-1)?.feedSize ?? 100;
  const outside = points.filter((point) => point.rank === null).length;

  // Zoom to the range actually occupied, so a move from #24 to #21 is visible
  // rather than a flat line squashed against a 1-to-100 axis.
  const ranked = points.map((p) => p.rank).filter((r): r is number => r !== null);
  const best = ranked.length ? Math.max(1, Math.min(...ranked) - 3) : 1;
  const worst = ranked.length ? Math.min(feedSize, Math.max(...ranked) + 3) : feedSize;

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <ChartContainer config={config} className={cn("h-[280px] w-full", className)}>
        <AreaChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <defs>
            {/* A stroke alone reads as a stray hairline on a dark panel. The
                fill gives the series enough presence to be the subject of the
                section rather than a detail inside it. */}
            <linearGradient id="rankFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-rank)" stopOpacity={0.26} />
              <stop offset="100%" stopColor="var(--color-rank)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="capturedAt"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            /*
             * Explicit ticks, one per day. Readings are hourly and every
             * label is a date, so letting recharts space ticks evenly printed
             * "13 Aug" three times in a row and the axis read as broken.
             */
            ticks={dayTicks(data.map((point) => point.capturedAt))}
            tickFormatter={formatDay}
          />
          <YAxis
            // Rank 1 at the top. See the note above.
            reversed
            domain={[best, worst]}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => `#${value}`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatDay(payload?.[0]?.payload?.capturedAt as string)
                }
                formatter={(value) => [`#${value}`, " in Education, UZ"]}
              />
            }
          />
          <Area
            dataKey="rank"
            type="monotone"
            stroke="var(--color-rank)"
            strokeWidth={2.5}
            fill="url(#rankFill)"
            dot={false}
            activeDot={{ r: 4 }}
            // A break in the line is information, not a rendering gap.
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ChartContainer>

      <p className="text-muted-foreground shrink-0 text-xs">
        Lower is better.{" "}
        {outside > 0
          ? `Breaks in the line are readings where the app sat outside the top ${feedSize}.`
          : `Tracked against the top ${feedSize} of the Education chart.`}
      </p>
    </div>
  );
}
