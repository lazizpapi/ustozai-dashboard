import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { MarketRaceChart } from "@/components/dashboard/market-race-chart";
import { PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import {
  competitorRankSeries,
  educationChartTop,
  marketOverview,
  recentListingActivity,
  watchedListingCount,
  type MarketApp,
} from "@/lib/db/queries";
import { COMPETITORS, IOS_APP_ID } from "@/lib/collectors/config";
import { fieldLabel, releaseNoteExcerpt, RELEASE_NOTE_CHARS } from "@/lib/market";
import { APP_STORE_MARK, GOOGLE_PLAY_MARK } from "@/components/tv/brand-logo";
import {
  delta,
  formatDay,
  formatNumber,
  formatRating,
  formatSigned,
  rankDelta,
  NO_VALUE,
} from "@/lib/format";
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
    return <span className="text-muted-foreground/60">{NO_VALUE}</span>;
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
  if (value === null) return <span className="text-muted-foreground/60">{NO_VALUE}</span>;
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

/**
 * Whether a change is ours, so our rows carry the same tag the table above
 * gives our row.
 *
 * The name rather than the store id, because recentListingChanges has already
 * resolved both of our store ids to this one name and the id is not on the
 * row by the time it arrives here.
 */
const OUR_NAME = "Ustoz AI";
const isOurs = (change: { appName: string }) => change.appName === OUR_NAME;

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
  return <span className="text-muted-foreground">{NO_VALUE}</span>;
}

export default async function MarketPage() {
  const result = await load(async () => {
    const [apps, chartTop, activity, watchedCount, race] = await Promise.all([
      marketOverview(),
      educationChartTop(),
      recentListingActivity(),
      watchedListingCount(),
      competitorRankSeries(),
    ]);
    return { apps, chartTop, activity, watchedCount, race };
  }, "/market");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { apps, chartTop, activity, watchedCount, race } = result.data;
  const { releases, edits } = activity;
  const trackedIds = new Set([
    IOS_APP_ID,
    ...COMPETITORS.flatMap((c) => (c.iosId ? [c.iosId] : [])),
  ]);
  const collecting = apps.some((app) => !app.isOurs && app.rank === null && app.playInstalls === null);

  /*
   * The spans the movement columns actually measured, named once here rather
   * than repeated in every cell. Until a full week of competitor readings
   * exists these are shorter than the heading would otherwise imply, and
   * saying "over 4 days" once beats printing it six times.
   */
  const spans = [
    ...apps.map((app) => app.rankSpanDays),
    ...apps.map((app) => app.playInstallsSpanDays),
  ].filter((span): span is number => span !== null);
  const longestSpan = spans.length ? Math.max(...spans) : null;
  const velocitySpans = apps
    .map((app) => app.playVelocitySpanDays)
    .filter((span): span is number => span !== null);
  const velocitySpan = velocitySpans.length ? Math.max(...velocitySpans) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Market"
        note={
          longestSpan && longestSpan < 7
            ? `Education apps in Uzbekistan. Movement spans up to ${longestSpan} days so far.`
            : "Education apps in Uzbekistan. Movement is against a week ago."
        }
      />

      {/*
        The race first, because it answers the page's question directly. The
        table below it says who is ahead today; only this says who is closing.
      */}
      <Section
        title="The race"
        note="Education chart position, every tracked app"
      >
        <MarketRaceChart points={race.points} apps={race.apps} />
      </Section>

      <Section
        title="Where we stand"
        note="chart position follows recent downloads, not total installs"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-xs">
                <th className="px-3 py-2 text-left font-medium">App</th>
                <th className="px-3 py-2 text-right font-medium">Education</th>
                <th className="px-3 py-2 text-right font-medium">Move</th>
                {/*
                  Velocity sits before the lifetime total on purpose. It is the
                  figure that actually compares two apps of different ages, so
                  it should be the one the eye lands on first.

                  The window is named in the header rather than the footnote
                  because the company view reports our own installs per day
                  over a shorter window, and two different figures for the
                  same-sounding metric have to carry their spans where they
                  cannot be missed.
                */}
                <th className="px-3 py-2 text-right font-medium">
                  Installs / day
                  {velocitySpan ? (
                    <span className="text-muted-foreground/70 block font-normal">
                      {velocitySpan}-day average
                    </span>
                  ) : null}
                </th>
                <th className="px-3 py-2 text-right font-medium">Play installs</th>
                <th className="px-3 py-2 text-right font-medium">Move</th>
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
                  <td className="px-3 py-2">
                    {/* Each name opens that app's profile: velocity over time,
                        chart history and what they have been changing. */}
                    <Link
                      href={`/market/${app.slug}`}
                      className={cn(
                        "hover:underline underline-offset-4",
                        app.isOurs && "font-medium",
                      )}
                    >
                      {app.name}
                    </Link>
                    {app.isOurs ? (
                      <span className="text-muted-foreground ml-2 text-xs">ours</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Rank app={app} />
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    <Move change={rankDelta(app.rank, app.rankPrevious)} />
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {app.playInstallsPerDay === null ? (
                      <span className="text-muted-foreground/60">{NO_VALUE}</span>
                    ) : (
                      formatSigned(app.playInstallsPerDay)
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {formatNumber(app.playInstalls)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    <Move change={delta(app.playInstalls, app.playInstallsPrevious)} />
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {formatRating(app.playRating)}
                    {app.playRatingCount ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {formatNumber(app.playRatingCount)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
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
          note={`Education, top free, iPhone, Uzbekistan, ${chartTop.date ? formatDay(chartTop.date) : ""}`}
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
        <Section title="Releases" note="what tracked apps shipped, newest first">
          {releases.length > 0 ? (
            <ul className="divide-y text-sm">
              {releases.map((release) => (
                <li
                  key={`${release.appId}-${release.detectedAt}`}
                  /*
                   * A grid, not a wrapping inline row. The fixed gutter is what
                   * gives the dates and the app names a column to scan down,
                   * and it keeps the notes paragraph in the body column at
                   * every width. As an inline flex child the paragraph was
                   * capped by max-w rather than filling the line, so above
                   * about 1200px it sat beside the row and read as a stray
                   * hanging indent belonging to nothing.
                   */
                  className="grid grid-cols-[4.25rem_1fr] gap-x-4 py-3"
                >
                  <span className="text-muted-foreground tnum text-xs">
                    {formatDay(release.detectedAt)}
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{release.appName}</span>
                      {isOurs(release) ? (
                        <span className="text-muted-foreground text-xs">ours</span>
                      ) : null}
                      <span className="text-muted-foreground [&>svg]:size-3.5">
                        {release.platform === "ios" ? APP_STORE_MARK : GOOGLE_PLAY_MARK}
                      </span>
                      {release.version ? (
                        <span className="tnum text-xs">{release.version}</span>
                      ) : null}
                    </div>
                    {releaseNoteExcerpt(release.releaseNotes, RELEASE_NOTE_CHARS) ? (
                      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
                        {releaseNoteExcerpt(release.releaseNotes, RELEASE_NOTE_CHARS)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No release seen yet. Watching {watchedCount}{" "}
              {watchedCount === 1 ? "listing" : "listings"}; a new version on
              either store appears here.
            </p>
          )}
        </Section>
      ) : null}

      {/*
        The other half, and a different event. Nobody shipped: they reworded
        the store page to win search, which is an ASO experiment run in public.
        Below releases and one line each, because it is the weaker signal.
      */}
      {watchedCount > 0 && edits.length > 0 ? (
        <Section
          title="Store page edits"
          note="listing changes that shipped no new version"
        >
          <ul className="divide-y text-sm">
            {edits.map((edit) => (
              <li
                key={`${edit.appId}-${edit.detectedAt}`}
                className="grid grid-cols-[4.25rem_1fr] gap-x-4 py-2"
              >
                <span className="text-muted-foreground tnum text-xs">
                  {formatDay(edit.detectedAt)}
                </span>
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{edit.appName}</span>
                  {isOurs(edit) ? (
                    <span className="text-muted-foreground text-xs">ours</span>
                  ) : null}
                  <span className="text-muted-foreground [&>svg]:size-3.5">
                    {edit.platform === "ios" ? APP_STORE_MARK : GOOGLE_PLAY_MARK}
                  </span>
                  <span className="text-muted-foreground">
                    changed {edit.changedFields.map(fieldLabel).join(", ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        {collecting
          ? "Competitor figures fill in on the next hourly poll. "
          : longestSpan && longestSpan < 7
            ? `Movement compares the newest reading against the oldest held, up to ${longestSpan} days back, and reaches a full week once that much history exists. `
            : "Movement compares the newest reading against the newest from a week ago. "}
        {velocitySpan
          ? `Installs per day is Google's published total spread across the ${velocitySpan} days between readings, which is the figure that compares apps of different ages: a lifetime total mostly measures how long an app has existed. `
          : "Installs per day needs two readings a day apart before it can be derived. "}
        Apple ranks the Education chart on recent download velocity rather than
        on how many people have the app, which is why an app can sit above
        another that has more installs. Play updates its published total
        roughly once a day.
      </p>
    </div>
  );
}
