import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import {
  educationChartTop,
  marketOverview,
  recentListingChanges,
  watchedListingCount,
  type MarketApp,
} from "@/lib/db/queries";
import { COMPETITORS, IOS_APP_ID } from "@/lib/collectors/config";
import { delta, formatDay, formatNumber, formatRating, rankDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Us against the education apps around us in the Uzbek chart.
 *
 * A table, because the whole job of this page is comparing the same handful of
 * figures across a handful of apps, and any other arrangement makes that harder
 * rather than prettier.
 *
 * Direction is an arrow, never a colour. Colour already means iOS or Android
 * across this dashboard, and a third meaning would compete with those two.
 */

function Move({ change }: { change: ReturnType<typeof delta> }) {
  if (change.direction === "unknown") {
    /*
     * No reading from a week ago, which is not the same claim as "new".
     * This said "new" against Praktika's 19.6 million installs on the day
     * competitor tracking started, which is simply false: the app is years
     * old, we had just started watching it. A dash says nothing, correctly,
     * and the footnote below explains when the column fills in.
     */
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (change.direction === "flat") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <Minus className="size-3" aria-hidden />
      </span>
    );
  }

  const Arrow = change.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <Arrow className="size-3" aria-hidden />
      <span className="tnum">{change.magnitude}</span>
    </span>
  );
}

/**
 * Chart movement is already a signed number of places, so it renders directly
 * rather than through delta(). "New" means entered the stored top 20, which
 * is a different claim from new to the store, and the label stays that modest.
 */
function ChartMove({ value, isNew }: { value: number | null; isNew: boolean }) {
  if (isNew) return <span className="text-muted-foreground/60 text-xs">entered</span>;
  if (value === null) return <span className="text-muted-foreground/60">—</span>;
  if (value === 0) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <Minus className="size-3" aria-hidden />
      </span>
    );
  }

  const Arrow = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1">
      <Arrow className="size-3" aria-hidden />
      <span className="tnum">{Math.abs(value)}</span>
    </span>
  );
}

/** The human names for listing fields, in the timeline's phrasing. */
const FIELD_LABELS: Record<string, string> = {
  title: "name",
  description: "description",
  version: "version",
  releaseNotes: "release notes",
  screenshots: "screenshots",
  icon: "icon",
};

const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** Outside the chart is a real answer and reads differently from no reading. */
function Rank({ app }: { app: MarketApp }) {
  if (app.rank !== null) return <span className="tnum">#{app.rank}</span>;
  if (app.feedSize) {
    return (
      <span className="text-muted-foreground text-xs">
        outside top {app.feedSize}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

export default async function MarketPage() {
  const result = await load(async () => {
    const [apps, chartTop, listingChanges, watchedCount] = await Promise.all([
      marketOverview(),
      educationChartTop(),
      recentListingChanges(),
      watchedListingCount(),
    ]);
    return { apps, chartTop, listingChanges, watchedCount };
  });

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { apps, chartTop, listingChanges, watchedCount } = result.data;
  const trackedIds = new Set([
    IOS_APP_ID,
    ...COMPETITORS.flatMap((c) => (c.iosId ? [c.iosId] : [])),
  ]);
  const collecting = apps.some((app) => !app.isOurs && app.rank === null && app.playInstalls === null);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Market"
        note="Education apps in Uzbekistan. Movement is against a week ago."
      />

      <Section
        title="Where we stand"
        note="chart position follows recent downloads, not total installs"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="px-3 py-2 text-left font-medium">App</th>
                <th className="px-3 py-2 text-right font-medium">Education</th>
                <th className="px-3 py-2 text-right font-medium">Week</th>
                <th className="px-3 py-2 text-right font-medium">Play installs</th>
                <th className="px-3 py-2 text-right font-medium">Week</th>
                <th className="px-3 py-2 text-right font-medium">Play</th>
                <th className="px-3 py-2 text-right font-medium">App Store</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr
                  key={app.slug}
                  className={cn("border-b last:border-b-0", app.isOurs && "bg-muted/40")}
                >
                  <td className="px-3 py-2.5">
                    <span className={cn(app.isOurs && "font-medium")}>{app.name}</span>
                    {app.isOurs ? (
                      <span className="text-muted-foreground ml-2 text-xs">ours</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Rank app={app} />
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    <Move change={rankDelta(app.rank, app.rankPrevious)} />
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    {formatNumber(app.playInstalls)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs">
                    <Move change={delta(app.playInstalls, app.playInstallsPrevious)} />
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    {formatRating(app.playRating)}
                    {app.playRatingCount ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {formatNumber(app.playRatingCount)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    {formatRating(app.iosRating)}
                    {app.iosRatingCount ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {formatNumber(app.iosRatingCount)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/*
        The chart's visible top, only once the poll has stored a day of it.
        Depth is set in the collector (30, deep enough to include us), so
        widening it is a deploy rather than a schema change.
      */}
      {chartTop.movers.length > 0 ? (
        <Section
          title="Top of the chart"
          note={`Education, top free, iPhone, Uzbekistan — ${chartTop.date ? formatDay(chartTop.date) : ""}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="px-3 py-2 text-right font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">App</th>
                  <th className="px-3 py-2 text-right font-medium">Day</th>
                  <th className="px-3 py-2 text-right font-medium">Week</th>
                </tr>
              </thead>
              <tbody>
                {chartTop.movers.map((mover) => {
                  const isOurs = mover.storeId === IOS_APP_ID;
                  return (
                    <tr
                      key={mover.storeId}
                      className={cn("border-b last:border-b-0", isOurs && "bg-muted/40")}
                    >
                      <td className="tnum text-muted-foreground px-3 py-2 text-right">
                        {mover.rank}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(isOurs && "font-medium")}>{mover.name}</span>
                        {isOurs ? (
                          <span className="text-muted-foreground ml-2 text-xs">ours</span>
                        ) : trackedIds.has(mover.storeId) ? (
                          <span className="text-muted-foreground/60 ml-2 text-xs">
                            tracked
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <ChartMove value={mover.vsYesterday} isNew={mover.isNew} />
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <ChartMove value={mover.vsWeek} isNew={false} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {/*
        Listing changes: a competitor editing their title, description or
        screenshots is an ASO experiment run in public. The section appears as
        soon as baselines exist, because "we are watching and nothing moved"
        is itself information; before any baseline there is nothing honest to
        say, so it stays hidden.
      */}
      {watchedCount > 0 ? (
        <Section
          title="Listing changes"
          note="store page edits across every tracked app, ours included"
        >
          {listingChanges.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {listingChanges.map((change) => (
                <li
                  key={`${change.appId}-${change.detectedAt}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="text-muted-foreground tnum text-xs">
                    {formatDay(change.detectedAt)}
                  </span>
                  <span className="font-medium">{change.appName}</span>
                  <span className="text-muted-foreground text-xs">
                    {change.platform === "ios" ? "App Store" : "Google Play"}
                  </span>
                  <span className="text-muted-foreground">
                    changed {change.changedFields.map(fieldLabel).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No listing changes yet. Watching {watchedCount}{" "}
              {watchedCount === 1 ? "listing" : "listings"}; a change to a
              title, description, screenshots or version will appear here.
            </p>
          )}
        </Section>
      ) : null}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        {collecting
          ? "Competitor figures fill in on the next hourly poll, and weekly movement appears once seven days of readings exist. "
          : "Weekly movement compares the newest reading against the newest from a week ago. "}
        Apple ranks the Education chart on recent download velocity rather than
        on how many people have the app, which is why an app can sit above
        another that has more installs. Play install counts are Google&apos;s own
        published totals and it updates them roughly once a day.
      </p>
    </div>
  );
}
