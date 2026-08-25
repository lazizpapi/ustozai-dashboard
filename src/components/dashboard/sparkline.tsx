"use client";

import { useId } from "react";
import { Area, AreaChart, YAxis } from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/**
 * The shape of a number, under the number itself.
 *
 * A metric tile states where a figure stands today and how far it moved in a
 * week. Neither says whether the week was a steady climb or a fall already
 * recovered, and the history to answer that is usually sitting in the page's
 * own query result, discarded once the delta was computed.
 *
 * Deliberately not a chart: no axes, no grid, no tooltip, no legend. It carries
 * one fact, the trajectory, and the Rankings and Downloads pages exist for
 * anyone who wants to read a value off it. Treating it as a small chart is how
 * a strip of nine tiles becomes nine competing plots.
 */

export interface SparkPoint {
  /** Any stable ordinal. Only the sequence is used; nothing is labelled. */
  at: string;
  value: number | null;
}

interface SparklineProps {
  points: SparkPoint[];
  /**
   * For series where a smaller number is better, such as a chart position.
   *
   * Without it a climb from #24 to #21 slopes downward, which is exactly
   * backwards, and the curve would contradict the arrow beside it on its own
   * tile. Same reasoning as the reversed axis in RankChart.
   */
  invert?: boolean;
  className?: string;
}

/* Roughly a tile's width at the four-column breakpoint. Only ever seen for the
 * frame before the container measures itself; the point is that the first paint
 * is close instead of 320x200 collapsing into a 32px box. */
const INITIAL = { width: 160, height: 32 } as const;

export function Sparkline({ points, invert = false, className }: SparklineProps) {
  // Unique per instance. Four tiles in one strip would otherwise share a
  // gradient id and the later ones would paint with the first one's fill.
  const gradientId = useId().replace(/:/g, "");

  // One point is a dot, not a trajectory. Better nothing than a line implying
  // a trend from a single reading.
  if (points.filter((point) => point.value !== null).length < 2) return null;

  return (
    <ChartContainer
      config={{}}
      initialDimension={INITIAL}
      className={cn("h-8 w-full", className)}
    >
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Padded so the line never sits flush against the top or bottom edge,
            where it would read as clipped rather than as a peak. */}
        <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} reversed={invert} />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--chart-line)"
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={false}
          // A gap is a reading that fell outside the feed, not missing data,
          // so the line breaks rather than bridging it.
          connectNulls={false}
          // Static. Nine of these animating on every load is motion spent on
          // decoration, and the strip's job is to be read at a glance.
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
