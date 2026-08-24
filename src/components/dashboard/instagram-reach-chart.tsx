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
import type { InstagramDay } from "@/lib/db/queries";

/**
 * Daily reach against daily views.
 *
 * One y axis, never two, for the same reason the downloads chart gives: a
 * dual-scale chart puts the crossing point wherever the scales decide, which
 * is an artifact rather than a fact. These two are close enough in magnitude
 * to share a scale honestly, and the gap between them is the point — views
 * above reach is the same people watching more than once.
 *
 * Identity rests on the legend rather than the colour, so the accent and the
 * neutral can carry the two series without implying that one matters more.
 *
 * The caption exists because reach is a unique count. Somebody will eventually
 * want a monthly reach figure and the honest answer is that it cannot be had
 * by adding these points up.
 */

const config = {
  reach: { label: "Accounts reached", color: "var(--chart-line)" },
  views: { label: "Views", color: "var(--chart-line-secondary)" },
} satisfies ChartConfig;

export function InstagramReachChart({ days }: { days: InstagramDay[] }) {
  const data = days
    .filter((day) => day.reach !== null || day.views !== null)
    .map((day) => ({ date: day.date, reach: day.reach, views: day.views }));

  if (data.length < 2) {
    return (
      <p className="text-muted-foreground py-12 text-sm">
        Not enough days collected yet to draw a line. The next daily run adds
        one.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ChartContainer config={config} className="h-[300px] w-full">
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
                labelFormatter={(_, payload) => formatDay(payload?.[0]?.payload?.date as string)}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="reach"
            name="Accounts reached"
            type="monotone"
            stroke="var(--color-reach)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            dataKey="views"
            name="Views"
            type="monotone"
            stroke="var(--color-views)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ChartContainer>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Reach counts accounts, not impressions, and it is deduplicated within
        each day. A week&rsquo;s reach is therefore not the sum of its days:
        somebody who saw the account on Monday and Thursday is one account that
        week and two here. Views counts every watch, so it can be added up.
      </p>
    </div>
  );
}
