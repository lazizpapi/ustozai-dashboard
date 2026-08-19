"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatBucket } from "@/lib/format";
import type { GrowthPoint, Period } from "@/lib/growth";

/**
 * How much a single figure moved, one bar per period.
 *
 * Bars rather than a line, because these are discrete quantities per bucket
 * rather than a continuous value being sampled. A line between them would
 * imply intermediate readings that do not exist.
 *
 * Two decisions carry most of the honesty here:
 *
 * The axis is not clamped at zero and a zero line is always drawn. Followers
 * leave as well as arrive, and a chart that can only render growth turns a bad
 * week into a flat one.
 *
 * The bucket still in progress is drawn hollow. Today is a partial day and this
 * month a partial month, so their bars are always the shortest on screen and
 * read as a collapse. Marking it costs one visual distinction and prevents the
 * most common misreading of a chart shaped like this.
 *
 * Two recharts specifics, both of which look like missing data rather than
 * errors when they bite. Entry animation is off because in this version the
 * bars never finish animating in and stay at zero height, so the chart renders
 * empty. And bar width is capped, because a series with a single bucket
 * otherwise stretches that one bar across the full width and reads as a filled
 * region rather than as one day.
 */

const config = {
  complete: { label: "Net change", color: "var(--chart-line)" },
  partial: { label: "In progress", color: "var(--chart-line)" },
} satisfies ChartConfig;

/**
 * Split into two series rather than colouring each bar individually.
 *
 * Recharts 3 renders nothing for a <Cell> inside a <Bar>: the rectangles appear
 * in the DOM as empty groups and the chart looks like it has no data. Two
 * series sharing a stackId sidesteps that entirely, and because exactly one of
 * them is non-null per bucket, nothing actually stacks; each bar keeps the full
 * column width.
 */
function split(points: GrowthPoint[]) {
  return points.map((point) => ({
    bucket: point.bucket,
    isPartial: point.isPartial,
    complete: point.isPartial ? null : point.value,
    partial: point.isPartial ? point.value : null,
  }));
}

interface GrowthChartProps {
  points: GrowthPoint[];
  period: Period;
  /** Shown when there is nothing yet, explaining when there will be. */
  emptyNote: string;
}

export function GrowthChart({ points, period, emptyNote }: GrowthChartProps) {
  if (points.length === 0) {
    return <p className="text-muted-foreground py-10 text-sm">{emptyNote}</p>;
  }

  const hasPartial = points.some((point) => point.isPartial);
  const hasLoss = points.some((point) => point.value < 0);

  /*
   * A series that is entirely zero collapses the axis to a single point, and
   * recharts then draws no ticks at all: an empty frame that reads as broken
   * rather than as "nothing moved". YouTube sits here for weeks at a time,
   * because it rounds to three significant figures. Giving the axis a range
   * keeps the chart legible and the zero readable.
   */
  const allZero = points.every((point) => point.value === 0);

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-[220px] w-full">
        <BarChart data={split(points)} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatBucket(value, period)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            domain={allZero ? [0, 1] : undefined}
            tickFormatter={(value: number) => value.toLocaleString("en-US")}
          />
          {/* Always drawn, so a bar below the line is unmistakable. */}
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  formatBucket(payload?.[0]?.payload?.bucket as string, period) +
                  (payload?.[0]?.payload?.isPartial ? " (in progress)" : "")
                }
              />
            }
          />
          <Bar
            dataKey="complete"
            name="Net change"
            stackId="a"
            isAnimationActive={false}
            maxBarSize={48}
            fill="var(--color-complete)"
            radius={2}
          />
          <Bar
            dataKey="partial"
            name="In progress"
            stackId="a"
            isAnimationActive={false}
            maxBarSize={48}
            fill="var(--color-partial)"
            fillOpacity={0.28}
            stroke="var(--color-partial)"
            strokeDasharray="3 2"
            radius={2}
          />
        </BarChart>
      </ChartContainer>

      {allZero ? (
        <p className="text-muted-foreground text-xs">No change across this whole range.</p>
      ) : null}

      {hasPartial || hasLoss ? (
        <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {hasPartial ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px] border border-dashed"
                style={{ borderColor: "var(--color-partial)" }}
                aria-hidden
              />
              still in progress, so lower than it will finish
            </span>
          ) : null}
          {hasLoss ? <span>Bars below the line are net losses.</span> : null}
        </p>
      ) : null}
    </div>
  );
}
