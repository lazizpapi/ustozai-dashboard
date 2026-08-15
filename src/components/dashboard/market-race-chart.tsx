"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatDay } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { RankSeriesPoint } from "@/lib/compare";

/**
 * Every tracked app's chart position on one time axis.
 *
 * The comparison the market page exists for. A table can say who is ahead
 * today; only this can show who is closing.
 *
 * Three things carry the honesty here, and two of them are inherited from the
 * single-app rank chart for the same reasons.
 *
 * The y axis is reversed, because rank 1 is the best outcome and belongs at
 * the top. Drawn conventionally, every climb slopes downward and the chart
 * reads as bad news for whoever is winning.
 *
 * Lines break rather than interpolate. A missing point means the poll ran and
 * that app was outside the tracked depth, which is a real state and a
 * different claim from "no reading".
 *
 * Ours is the only coloured line. Five rivals cannot each take a hue on a
 * dashboard where colour already means iOS or Android, so they separate by
 * lightness instead. That also puts the emphasis where the page's question
 * is: not who is winning, but where we sit among them.
 */

/** Competitor strokes, in the order apps arrive. Defined in globals.css. */
const RIVAL_COLORS = [
  "var(--rival-1)",
  "var(--rival-2)",
  "var(--rival-3)",
  "var(--rival-4)",
  "var(--rival-5)",
];

interface MarketRaceChartProps {
  points: RankSeriesPoint[];
  apps: { slug: string; name: string; isOurs: boolean }[];
}

export function MarketRaceChart({ points, apps }: MarketRaceChartProps) {
  const reducedMotion = useReducedMotion();

  if (points.length < 2) {
    return (
      <p className="text-muted-foreground py-10 text-sm">
        The race needs at least two days of readings. The next scheduled run
        adds one.
      </p>
    );
  }

  // Ours first so it takes the top of the legend and the tooltip.
  const ordered = [...apps].sort((a, b) => Number(b.isOurs) - Number(a.isOurs));

  let rivalIndex = 0;
  const config: ChartConfig = Object.fromEntries(
    ordered.map((app) => {
      const color = app.isOurs
        ? "var(--series-ios)"
        : RIVAL_COLORS[rivalIndex++ % RIVAL_COLORS.length];
      return [app.slug, { label: app.name, color }];
    }),
  );

  /*
   * Zoom to the band actually occupied. Ours sits in the twenties and the
   * leaders in the low single digits, so a fixed 1-to-100 axis would squash
   * every line worth reading into the top fifth of the frame.
   */
  const ranks = points.flatMap((point) =>
    ordered
      .map((app) => point[app.slug])
      .filter((rank): rank is number => typeof rank === "number"),
  );
  const best = ranks.length ? Math.max(1, Math.min(...ranks) - 2) : 1;
  const worst = ranks.length ? Math.max(...ranks) + 2 : 30;

  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="h-[300px] w-full">
        <LineChart data={points} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
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
                labelFormatter={(label) => formatDay(label as string)}
                formatter={(value, name) => [
                  `#${value}`,
                  ` ${config[name as string]?.label ?? name}`,
                ]}
              />
            }
          />
          {ordered.map((app) => (
            <Line
              key={app.slug}
              dataKey={app.slug}
              type="monotone"
              stroke={`var(--color-${app.slug})`}
              // Ours reads first at a glance, without a second colour meaning.
              strokeWidth={app.isOurs ? 2.5 : 1.5}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
          ))}
        </LineChart>
      </ChartContainer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {ordered.map((app) => (
          <span
            key={app.slug}
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
          >
            <span
              className="h-0.5 w-4 shrink-0 rounded-full"
              style={{ background: `var(--color-${app.slug})` }}
              aria-hidden
            />
            <span className={app.isOurs ? "text-foreground font-medium" : undefined}>
              {app.name}
            </span>
          </span>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Lower is better. A break in a line is a day that app sat outside the
        tracked depth of the chart.
      </p>
    </div>
  );
}
