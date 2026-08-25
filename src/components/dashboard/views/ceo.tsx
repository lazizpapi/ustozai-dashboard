import Link from "next/link";

import { ActiveUsersStrip } from "@/components/dashboard/active-users-strip";
import {
  APP_STORE_MARK,
  BrandLogo,
  GOOGLE_PLAY_MARK,
  type BrandKey,
} from "@/components/tv/brand-logo";
import { MarketPulse } from "@/components/dashboard/market-pulse";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { RankChart } from "@/components/dashboard/rank-chart";
import { Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import { PLAY_EDUCATION_CATEGORY } from "@/lib/collectors/config";
import { latestInstallRate } from "@/lib/installs";
import {
  activeUsersTrend,
  engagementSummary,
  revenueSummary,
  androidDailyInstalls,
  androidInstallsSoFarToday,
  educationChartTop,
  iosDailyDownloads,
  latestAnalystReport,
  ownReleases,
  rankHistory,
  rankTrend,
  ratingTrend,
  socialTrends,
} from "@/lib/db/queries";
import {
  delta,
  formatDay,
  formatNumber,
  formatRank,
  formatRating,
  formatRatingDelta,
  rankDelta,
  timeAgo,
  NO_VALUE,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Are we growing?
 *
 * Every figure the founders asked for, with the competitive position and the
 * analyst's current read beside them.
 *
 * This was pinned to one viewport at first. It read as cramped, because
 * fitting eight metrics, a chart and a panel into a fixed height means
 * shrinking all of them: the numbers ended up smaller than the labels around
 * them. The figures now take the room they need and the page scrolls, which
 * is the ordinary trade a dashboard makes.
 */

const SOCIAL_LABELS = {
  telegram: "Telegram",
  instagram: "Instagram",
  youtube: "YouTube",
} as const;

const HEALTH_DOT = {
  green: "bg-status-ok",
  yellow: "bg-status-warn",
  red: "bg-status-critical",
} as const;

/**
 * How a chart position reads on a tile.
 *
 * Three states, because "we are not in the top hundred" and "this chart has
 * never been polled" are different facts and a bare dash says neither. The
 * feed size is quoted from the reading rather than hardcoded: Apple caps at
 * 100 today, and a tile that assumed it would quietly lie the day it changes.
 */
function rankTile(trend: { current: number | null; feedSize: number | null }) {
  if (trend.current !== null) {
    return {
      value: formatRank(trend.current),
      detail: trend.feedSize ? `of top ${trend.feedSize} in Uzbekistan` : "Uzbekistan",
    };
  }
  if (trend.feedSize) {
    return { value: `outside ${trend.feedSize}`, detail: "Uzbekistan" };
  }
  return { value: formatRank(null), detail: "not collected yet" };
}

export async function CeoView() {
  const result = await load(() =>
    Promise.all([
      rankTrend(),
      rankTrend("topfree", "uz", PLAY_EDUCATION_CATEGORY, "android"),
      ratingTrend("ios"),
      ratingTrend("android"),
      androidDailyInstalls(30),
      iosDailyDownloads(30),
      rankHistory("topfree", "uz", undefined, 90),
      // The Play equivalent, for its tile's curve. Thirty days rather than
      // ninety: the tile shows a month, and the big chart below is Apple's.
      rankHistory("topfree", "uz", PLAY_EDUCATION_CATEGORY, 30, "android"),
      ownReleases(90),
      // Chained so socialTrends sees the new reading, and inside the
      // Promise.all so the fetch overlaps the other queries.
      refreshAudienceIfStale().then(() => socialTrends()),
      androidInstallsSoFarToday(),
      educationChartTop(),
      latestAnalystReport(),
      activeUsersTrend(),
      revenueSummary(30),
      engagementSummary(30),
    ]),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const [
    rank,
    playRank,
    ios,
    android,
    installs,
    downloads,
    history,
    playHistory,
    releases,
    social,
    playToday,
    chart,
    analyst,
    active,
    revenue,
    engagement,
  ] = result.data;

  /*
   * The strip's curves, all cut to the same thirty days so four tiles side
   * by side cover one window. history arrives as ninety for the chart below.
   */
  /*
   * Cut by timestamp rather than by a count of rows: the poll runs every three
   * hours today, and counting back a fixed number of readings would quietly
   * mean a different window the moment that interval changes.
   *
   * Measured back from the newest reading, not from now. Reading the clock
   * during render is impure, and anchoring to the data also keeps the window
   * honest if a collector stalls: thirty days of readings stays thirty days of
   * readings rather than decaying into a stub as the gap grows.
   */
  const newest = history.at(-1)?.capturedAt;
  const since = newest ? new Date(newest).getTime() - 30 * 24 * 60 * 60 * 1000 : 0;
  const rankSpark = history
    .filter((point) => new Date(point.capturedAt).getTime() >= since)
    .map((point) => ({ at: point.capturedAt, value: point.rank }));
  const playRankSpark = playHistory.map((point) => ({
    at: point.capturedAt,
    value: point.rank,
  }));
  const downloadSpark = downloads.map((row) => ({ at: row.date, value: row.downloads }));
  const installSpark = installs.map((row) => ({ at: row.date, value: row.installs }));

  const appStoreRank = rankTile(rank);
  const playStoreRank = rankTile(playRank);
  const installRate = latestInstallRate(installs);
  const lastDownload = downloads.at(-1) ?? null;
  const report = analyst?.report ?? null;

  return (
    <div className="space-y-8">
      {/*
        Active users first. They are the only figures here that describe
        people using the app rather than the store pages around it, so they
        answer "are we growing" more directly than a download count does.
      */}
      <ActiveUsersStrip active={active} revenue={revenue} engagement={engagement} />
      <MetricStrip wide>
        {/*
          Two tiles rather than one. This was a single "Education, UZ" that
          meant Apple and never said so, which is unreadable next to the
          install and rating tiles that do name their store.

          Every store tile now carries its mark and names its store in full.
          Six of the nine figures here belong to one shop or the other, and
          "iOS rating" beside "Play installs" asked the reader to hold two
          naming schemes at once: one named the operating system, the other
          named the shop. The pairs also run Apple first throughout, so the
          order is learned once rather than re-read on every row.
        */}
        <Metric
          icon={APP_STORE_MARK}
          label="Education, App Store"
          value={appStoreRank.value}
          detail={appStoreRank.detail}
          change={rankDelta(rank.current, rank.previous, rank.spanDays)}
          spark={{ points: rankSpark, invert: true }}
        />

        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Education, Google Play"
          value={playStoreRank.value}
          detail={playStoreRank.detail}
          change={rankDelta(playRank.current, playRank.previous, playRank.spanDays)}
          spark={{ points: playRankSpark, invert: true }}
        />

        <Metric
          icon={APP_STORE_MARK}
          label="App Store downloads, daily"
          value={lastDownload ? formatNumber(lastDownload.downloads) : NO_VALUE}
          detail={lastDownload ? undefined : "not connected"}
          asOf={lastDownload ? `on ${formatDay(lastDownload.date)}` : undefined}
          spark={{ points: downloadSpark }}
        />

        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play installs, daily"
          /*
           * Google publishes a running total and moves it in batches, landing
           * every day or two rather than daily. So the last derived day is
           * usually a zero meaning "the batch has not arrived", and the batch
           * day itself holds two days of installs. latestInstallRate spreads
           * the movement over the days it covers, and the span is stated so
           * nobody reads an average as a measurement.
           */
          value={
            installRate
              ? formatNumber(installRate.perDay)
              : playToday
                ? `+${formatNumber(playToday.installs)}`
                : NO_VALUE
          }
          detail={
            installRate
              ? installRate.spanDays > 1
                ? `over ${installRate.spanDays} days`
                : undefined
              : playToday
                ? "today so far"
                : "first full day lands tomorrow"
          }
          asOf={installRate ? `to ${formatDay(installRate.date)}` : undefined}
          spark={{ points: installSpark }}
        />

        <Metric
          icon={APP_STORE_MARK}
          label="App Store rating"
          value={formatRating(ios.current)}
          detail={
            ios.ratingCount !== null ? `${formatNumber(ios.ratingCount)} ratings` : undefined
          }
          change={formatRatingDelta(ios.current, ios.previous, ios.spanDays)}
        />

        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play rating"
          value={formatRating(android.current)}
          detail={
            android.ratingCount !== null
              ? `${formatNumber(android.ratingCount)} ratings`
              : undefined
          }
          change={formatRatingDelta(android.current, android.previous, android.spanDays)}
        />

        {social.map((trend) => (
          <Metric
            key={trend.platform}
            // Each platform has its own page with the curve and the per-period
            // change; the strip can only afford the one number.
            href={`/audience/${trend.platform}`}
            icon={<BrandLogo platform={trend.platform as BrandKey} className="size-3.5" />}
            label={SOCIAL_LABELS[trend.platform]}
            value={
              trend.current === null
                ? NO_VALUE
                : `${trend.isExact ? "" : "≈"}${formatNumber(trend.current)}`
            }
            detail={trend.isExact ? undefined : "rounded by YouTube"}
            change={delta(trend.current, trend.previous, trend.spanDays)}
            asOf={trend.isStale ? `last read ${timeAgo(trend.capturedAt)}` : undefined}
          />
        ))}
      </MetricStrip>

      <MarketPulse chart={chart} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section title="Position over time" note="Education chart, Uzbekistan, iPhone">
<RankChart
            points={history}
            // The panel charts the iPhone Education feed, so only our iOS
            // builds belong on it.
            markers={releases.filter((release) => release.platform === "ios")}
            className="h-[300px]"
          />
        </Section>

        <Section title="Analyst">
  {analyst ? (
              <span className="text-muted-foreground text-xs">
                {timeAgo(analyst.createdAt)}
              </span>
            ) : null}
{report ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline gap-2">
                {analyst?.health ? (
                  <span
                    className={cn(
                      "mt-1.5 inline-block size-1.5 shrink-0 rounded-full",
                      HEALTH_DOT[analyst.health],
                    )}
                    aria-hidden
                  />
                ) : null}
                <p className="text-sm leading-snug text-balance">{report.headline}</p>
              </div>

              {report.recommendations.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-muted-foreground text-xs">Do next</h3>
                  <ol className="space-y-2">
                    {report.recommendations.slice(0, 2).map((recommendation, index) => (
                      <li key={index} className="text-xs leading-relaxed">
                        <span className="text-foreground">{recommendation.action}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          {recommendation.expectedImpact}, {recommendation.effort} effort
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <Link
                href="/analyst"
                className="text-muted-foreground hover:text-foreground mt-auto shrink-0 pt-1 text-xs transition-colors"
              >
                Read the full report
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs leading-relaxed">
              No report yet. The analyst writes one each morning after the daily
              collection.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
