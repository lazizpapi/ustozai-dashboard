import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo, type BrandKey } from "@/components/tv/brand-logo";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { FollowerChart } from "@/components/dashboard/follower-chart";
import { InstagramInsights } from "@/components/dashboard/instagram-insights";
import { GrowthChart } from "@/components/dashboard/growth-chart";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import { socialEnv } from "@/lib/env";
import {
  followerHistory,
  growthSeries,
  instagramAudience,
  instagramPerformance,
  instagramStories,
  instagramTopPosts,
  socialTrends,
  type GrowthSeriesKey,
} from "@/lib/db/queries";
import { PERIODS, PERIOD_LABELS, toPeriod } from "@/lib/growth";
import { delta, formatBucket, formatNumber, formatSigned, timeAgo, NO_VALUE} from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Everything we know about one audience platform.
 *
 * Reached by clicking the platform's figure on the dashboard, which is where
 * the question "how is Telegram doing" actually gets asked. The overview can
 * only afford one number per platform; this is the rest of it.
 *
 * Three things it deliberately separates, because they are three different
 * questions that a single follower count blurs together: what the count is
 * now, what shape its curve has, and how much it moved per period. The last
 * one reuses the growth page's own series so the two can never disagree.
 */

/**
 * The Instagram-only extras, gathered separately and allowed to fail.
 *
 * These sections are additive to a page that already works without them, so a
 * missing table — the usual cause being migration 0015 not yet applied to this
 * environment — should cost the new sections and nothing else. Letting it
 * throw would take the follower chart down with it and report the whole page
 * as unconfigured, which would be a worse answer than a shorter page.
 */
async function instagramInsights() {
  try {
    const [performance, posts, audience, stories] = await Promise.all([
      instagramPerformance(90),
      instagramTopPosts(90, 10),
      instagramAudience(),
      instagramStories(14),
    ]);
    return { performance, posts, audience, stories };
  } catch {
    return null;
  }
}

const PLATFORMS = {
  telegram: {
    label: "Telegram",
    key: "telegram" as GrowthSeriesKey,
    noun: "members",
    /** Telegram counts channel members, which can leave as well as join. */
    note: "Channel members, read live from Telegram whenever somebody joins or leaves, and reconciled every five minutes.",
    url: (handle: string) => `https://t.me/${handle}`,
  },
  instagram: {
    label: "Instagram",
    key: "instagram" as GrowthSeriesKey,
    noun: "followers",
    note: "Followers, read from the official Instagram API. The token rotates every sixty days and refreshes itself.",
    url: (handle: string) => `https://instagram.com/${handle}`,
  },
  youtube: {
    label: "YouTube",
    key: "youtube" as GrowthSeriesKey,
    noun: "subscribers",
    note: "Subscribers, as YouTube reports them. YouTube rounds this figure to three significant figures, so it moves in steps rather than one at a time.",
    url: (handle: string) => `https://youtube.com/@${handle}`,
  },
} as const;

type PlatformKey = keyof typeof PLATFORMS;

const isPlatform = (value: string): value is PlatformKey => value in PLATFORMS;

export default async function AudiencePlatformPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { platform: raw } = await params;
  // A 404 rather than a redirect: a mistyped platform is a wrong address, and
  // silently landing somewhere else hides the typo.
  if (!isPlatform(raw)) notFound();

  const platform = raw;
  const spec = PLATFORMS[platform];
  const period = toPeriod((await searchParams).period);

  const result = await load(async () => {
    // Chained so the trend sees any reading the refresh just took, matching
    // how the overview does it.
    const trends = await refreshAudienceIfStale().then(() => socialTrends());
    const [history, growth] = await Promise.all([
      followerHistory(platform, 90),
      growthSeries(spec.key, period),
    ]);
    return {
      trend: trends.find((entry) => entry.platform === platform) ?? null,
      history,
      growth,
      insights: platform === "instagram" ? await instagramInsights() : null,
    };
  }, "/audience");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { trend, history, growth, insights } = result.data;

  const configured = socialEnv()[platform];
  const handle = trend?.handle ?? (configured && "handle" in configured
    ? configured.handle
    : configured && "channel" in configured
      ? configured.channel
      : null);

  const complete = growth.points.filter((point) => !point.isPartial);
  const latestBucket = complete.at(-1);

  // Highest and lowest reading held, which is the cheapest useful context for
  // whether today's number is a peak or a dip.
  const counts = history.map((point) => point.followers);
  const peak = counts.length > 0 ? Math.max(...counts) : null;

  return (
    <div className="space-y-8">
      {/* Each refresh re-runs refreshAudienceIfStale above, so the numbers are
          re-read from the platform rather than re-read from the database. */}
      <AutoRefresh />
      <PageHeader
        title={spec.label}
        note={`${spec.noun[0].toUpperCase()}${spec.noun.slice(1)} over the last 90 days.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <BrandLogo platform={platform as BrandKey} className="size-6" />
        {handle ? (
          <a
            href={spec.url(handle)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            @{handle}
          </a>
        ) : null}
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground ml-auto text-xs transition-colors"
        >
          Back to the dashboard
        </Link>
      </div>

      <MetricStrip>
        <Metric
          label={`Current ${spec.noun}`}
          value={
            trend?.current === null || trend === null
              ? NO_VALUE
              : `${trend.isExact ? "" : "≈"}${formatNumber(trend.current)}`
          }
          detail={trend?.isExact === false ? "rounded by the platform" : undefined}
          change={delta(trend?.current ?? null, trend?.previous ?? null, trend?.spanDays ?? null)}
        />
        <Metric
          label="Highest reading held"
          value={peak === null ? NO_VALUE : formatNumber(peak)}
          detail={
            peak !== null && trend?.current !== null && trend?.current !== undefined
              ? peak === trend.current
                ? "which is where we are now"
                : `${formatNumber(peak - trend.current)} above today`
              : undefined
          }
        />
        <Metric
          label={`Latest ${PERIOD_LABELS[period].toLowerCase()} change`}
          value={latestBucket ? formatSigned(latestBucket.value) : NO_VALUE}
          detail={
            latestBucket
              ? `in the ${formatBucket(latestBucket.bucket, period)} period`
              : "needs two complete periods"
          }
        />
        <Metric
          label="Last reached"
          value={trend?.checkedAt ? timeAgo(trend.checkedAt) : NO_VALUE}
          detail={trend?.isStale ? "older than expected" : "on schedule"}
        />
      </MetricStrip>

      <Section title="Followers over time" note="every reading we hold, not a daily average">
        <FollowerChart points={history} isExact={trend?.isExact ?? true} />
      </Section>

      <Section
        title="Change per period"
        note="net, so people leaving counts against people joining"
      >
        <nav className="mb-4 flex flex-wrap gap-1" aria-label="Period">
          {PERIODS.map((option) => (
            <Link
              key={option}
              href={`/audience/${platform}?period=${option}`}
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

        <GrowthChart
          points={growth.points}
          period={period}
          emptyNote="Not enough complete periods yet to show a change."
        />
      </Section>

      {insights ? (
        <InstagramInsights
          performance={insights.performance}
          posts={insights.posts}
          audience={insights.audience}
          stories={insights.stories}
          followers={trend?.current ?? null}
        />
      ) : null}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        {spec.note}{" "}
        {trend?.isStale
          ? "This reading is older than the collection window, so the figure above may have moved since."
          : "Change per period is the difference between the last reading of one period and the last of the next, so a missed poll shifts a gain into the following period rather than losing it."}
      </p>
    </div>
  );
}
