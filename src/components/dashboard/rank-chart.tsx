"use client";

import { useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDay } from "@/lib/format";
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
  rank: { label: "Rank", color: "var(--series-ios)" },
} satisfies ChartConfig;

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Reads the OS reduced-motion setting.
 *
 * useSyncExternalStore rather than an effect writing state: this is a
 * subscription to something outside React, which is exactly what that hook is
 * for, and it avoids the extra render an effect would cost. The server
 * snapshot is false so the markup matches, and the client corrects on hydrate.
 */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

export function RankChart({ points }: { points: RankPoint[] }) {
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
    <div className="space-y-2">
      <ChartContainer config={config} className="h-[280px] w-full">
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.35} />
          <XAxis
            dataKey="capturedAt"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
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
          <Line
            dataKey="rank"
            type="monotone"
            stroke="var(--color-rank)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            // A break in the line is information, not a rendering gap.
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ChartContainer>

      <p className="text-muted-foreground text-xs">
        Lower is better.{" "}
        {outside > 0
          ? `Breaks in the line are readings where the app sat outside the top ${feedSize}.`
          : `Tracked against the top ${feedSize} of the Education chart.`}
      </p>
    </div>
  );
}
