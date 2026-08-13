import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { BrandLogo, type BrandKey } from "@/components/tv/brand-logo";
import { RankChart } from "@/components/dashboard/rank-chart";
import { FreshnessRow } from "@/components/dashboard/freshness";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import { load } from "@/app/load";
import {
  androidDailyInstalls,
  androidInstallsSoFarToday,
  collectorHealth,
  iosDailyDownloads,
  rankHistory,
  rankTrend,
  ratingTrend,
  recentReviews,
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
} from "@/lib/format";

const SOCIAL_LABELS = {
  telegram: "Telegram members",
  instagram: "Instagram followers",
  youtube: "YouTube subscribers",
} as const;

export const dynamic = "force-dynamic";

/**
 * Overview: the four figures that were actually asked for.
 *
 * Laid out as a hairline-divided strip rather than a row of cards, so the
 * numbers sit close enough to be read together.
 */
export default async function OverviewPage() {
  const result = await load(() =>
    Promise.all([
      rankTrend(),
      ratingTrend("ios"),
      ratingTrend("android"),
      androidDailyInstalls(30),
      iosDailyDownloads(30),
      rankHistory("topfree", "uz", undefined, 90),
      recentReviews(8),
      collectorHealth(),
      // Chained so socialTrends sees the new reading, and inside the
      // Promise.all so the fetch overlaps the other nine queries.
      refreshAudienceIfStale().then(() => socialTrends()),
      androidInstallsSoFarToday(),
    ]),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") {
    return <SetupNotice reason="no-data" />;
  }

  const [rank, ios, android, installs, downloads, history, reviews, health, social, playToday] =
    result.data;

  const lastInstall = installs.at(-1) ?? null;
  const lastDownload = downloads.at(-1) ?? null;

  return (
    <div className="space-y-12">
      <section>
        <MetricStrip>
          <Metric
            label="Education, Uzbekistan"
            value={
              rank.current === null && rank.feedSize
                ? `outside ${rank.feedSize}`
                : formatRank(rank.current)
            }
            detail={rank.feedSize ? `of ${rank.feedSize} tracked` : undefined}
            change={rankDelta(rank.current, rank.previous)}
          />

          <Metric
            label="Play installs, daily"
            /*
             * Play publishes a running total, so a daily figure is the gap
             * between two days and does not exist until a second day does.
             * Rather than an empty tile on day one, show the movement since
             * the first reading of today, labelled as partial. The counter has
             * genuinely moved; refusing to say so reads as a fault.
             */
            value={
              lastInstall
                ? formatNumber(lastInstall.installs)
                : playToday
                  ? `+${formatNumber(playToday.installs)}`
                  : "—"
            }
            detail={
              lastInstall
                ? undefined
                : playToday
                  ? "today so far"
                  : "first full day lands tomorrow"
            }
            asOf={lastInstall ? `on ${formatDay(lastInstall.date)}` : undefined}
          />

          <Metric
            label="App Store downloads, daily"
            value={lastDownload ? formatNumber(lastDownload.downloads) : "—"}
            detail={lastDownload ? undefined : "App Store Connect not connected"}
            asOf={lastDownload ? `on ${formatDay(lastDownload.date)}` : undefined}
          />

          <Metric
            label="Rating"
            value={formatRating(ios.current)}
            detail={
              ios.ratingCount !== null
                ? `iOS, ${formatNumber(ios.ratingCount)} ratings`
                : "iOS"
            }
            change={formatRatingDelta(ios.current, ios.previous)}
          />
        </MetricStrip>
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between gap-4 border-b pb-3">
          <h2 className="text-sm font-medium">Audience</h2>
          <span className="text-muted-foreground text-xs">followers and subscribers</span>
        </div>
        <MetricStrip>
          {social.map((trend) => (
            <Metric
              key={trend.platform}
              icon={
                <BrandLogo
                  platform={trend.platform as BrandKey}
                  className="size-4"
                />
              }
              label={SOCIAL_LABELS[trend.platform]}
              value={
                trend.current === null
                  ? "—"
                  : `${trend.isExact ? "" : "≈"}${formatNumber(trend.current)}`
              }
              detail={trend.isExact ? undefined : "YouTube rounds this"}
              change={delta(trend.current, trend.previous)}
              asOf={trend.isStale ? `last read ${timeAgo(trend.capturedAt)}` : undefined}
            />
          ))}
        </MetricStrip>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4 border-b pb-3">
          <h2 className="text-sm font-medium">Position over time</h2>
          <span className="text-muted-foreground text-xs">
            Education chart, Uzbekistan, iPhone
          </span>
        </div>
        <RankChart points={history} />
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-4 border-b pb-3">
            <h2 className="text-sm font-medium">Latest reviews</h2>
            <span className="text-muted-foreground text-xs">both stores</span>
          </div>

          {reviews.length === 0 ? (
            <p className="text-muted-foreground py-8 text-sm">
              No reviews collected yet.
            </p>
          ) : (
            <ul className="divide-y">
              {reviews.map((review) => (
                <li key={review.id} className="flex gap-4 py-3">
                  <span className="tnum text-muted-foreground w-10 shrink-0 text-sm">
                    {review.rating}/5
                  </span>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm">
                      {review.title || review.body || "(no text)"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {review.author ?? "anonymous"} · {review.platform} ·{" "}
                      {review.country.toUpperCase()} · {formatDay(review.submittedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="border-b pb-3">
            <h2 className="text-sm font-medium">Android</h2>
          </div>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Rating</dt>
              <dd className="tnum text-lg">
                {formatRating(android.current)}
                {android.ratingCount !== null ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    {formatNumber(android.ratingCount)} ratings
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Collector health</h3>
            <FreshnessRow sources={health} />
          </div>
        </section>
      </div>
    </div>
  );
}
