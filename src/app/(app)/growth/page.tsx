import Link from "next/link";

import { PageHeader, Section } from "@/components/dashboard/page-header";
import { GrowthChart } from "@/components/dashboard/growth-chart";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { GROWTH_SERIES, growthSeries, type GrowthSeriesKey } from "@/lib/db/queries";
import { PERIODS, PERIOD_LABELS, toPeriod, type Period } from "@/lib/growth";
import { formatBucket, formatDay, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * How much did we gain, per day, week, month and year.
 *
 * Grouped by what the numbers mean rather than by where they came from, so the
 * two review series sit together even though one is scraped and one is a feed.
 *
 * The period is a URL parameter rather than client state. It keeps the whole
 * page a server component, and it means a particular view can be linked to,
 * which is what people actually do with a chart worth discussing.
 */

const GROUPS: { title: string; note: string; keys: GrowthSeriesKey[] }[] = [
  {
    title: "Audience",
    note: "net change, so people leaving counts against people joining",
    keys: ["telegram", "instagram", "youtube"],
  },
  {
    title: "Reviews",
    note: "dated to when each review was written, not when we collected it",
    keys: ["iosReviews", "playReviews"],
  },
  {
    title: "Downloads",
    note: "App Store excludes updates; Play is the change in its running total",
    keys: ["iosDownloads", "playInstalls"],
  },
];

/**
 * Why a series is empty, in terms of when it will not be.
 *
 * "No data" is the least useful thing a chart can say. Each series knows the
 * day it started collecting, so it can say how long the wait is instead.
 */
function emptyNote(key: GrowthSeriesKey, period: Period): string {
  const since = GROWTH_SERIES[key].since;
  const need =
    period === "day"
      ? "two days"
      : period === "week"
        ? "two weeks"
        : period === "month"
          ? "two months"
          : "two years";

  return `Collecting since ${formatDay(since)}. This view needs about ${need} of history before it can show a change.`;
}

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const period = toPeriod((await searchParams).period);

  const result = await load(async () => {
    const keys = GROUPS.flatMap((group) => group.keys);
    const series = await Promise.all(keys.map((key) => growthSeries(key, period)));
    return new Map(series.map((entry) => [entry.key, entry]));
  });

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const series = result.data;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Growth"
        note="Change per period, in Tashkent time. Apple's download days are Apple's own."
      />

      <nav className="flex flex-wrap gap-1" aria-label="Period">
        {PERIODS.map((option) => (
          <Link
            key={option}
            href={`/growth?period=${option}`}
            aria-current={option === period ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              option === period
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {PERIOD_LABELS[option]}
          </Link>
        ))}
      </nav>

      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title} note={group.note}>
          <div className="grid gap-8 lg:grid-cols-2">
            {group.keys.map((key) => {
              const entry = series.get(key)!;
              const complete = entry.points.filter((point) => !point.isPartial);
              const latest = complete.at(-1);

              return (
                <div key={key} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <h3 className="text-sm font-medium">{entry.label}</h3>
                    {latest ? (
                      <span className="text-muted-foreground text-xs">
                        <span className="tnum text-foreground">
                          {formatSigned(latest.value)}
                        </span>{" "}
                        in the {formatBucket(latest.bucket, period)} period
                      </span>
                    ) : null}
                  </div>
                  <GrowthChart
                    points={entry.points}
                    period={period}
                    emptyNote={emptyNote(key, period)}
                  />
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        Audience figures are the difference between the last reading of one
        period and the last of the next, so a missed poll shifts a gain into the
        following period rather than losing it. YouTube rounds its subscriber
        count to three significant figures, so it will read as zero change for
        weeks at a time and that is the platform, not a broken collector.
      </p>
    </div>
  );
}
