import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { BrandLogo, type SocialKey } from "@/components/tv/brand-logo";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { PageHeader } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import { socialTrends } from "@/lib/db/queries";
import { delta, formatNumber, timeAgo, NO_VALUE } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The three audience platforms, and the way in to each.
 *
 * This route was reachable only by clicking a follower figure on a dashboard.
 * Typing the address it appears in, or removing a platform from the end of
 * one, returned a 404 rather than the obvious page, which is the sort of thing
 * that makes a reader assume the section is broken rather than that they
 * guessed the wrong URL.
 *
 * Deliberately thin. Everything worth saying about a platform is on the
 * platform's own page; a directory that restates it would be a second place to
 * keep the same figures right.
 */

const LABELS: Record<SocialKey, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  youtube: "YouTube",
};

export default async function AudiencePage() {
  const result = await load(
    // Chained so the counts reflect any reading the refresh just took, the
    // same way the overview and the platform pages do it.
    () => refreshAudienceIfStale().then(() => socialTrends()),
    "/audience",
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const trends = result.data;

  return (
    <div className="space-y-8">
      <AutoRefresh />

      <PageHeader
        title="Audience"
        note="Followers across the three channels. Open one for its curve and its history."
      />

      <MetricStrip>
        {trends.map((trend) => {
          const platform = trend.platform as SocialKey;
          return (
            <Metric
              key={trend.platform}
              href={`/audience/${trend.platform}`}
              icon={<BrandLogo platform={platform} className="size-3.5" />}
              label={LABELS[platform]}
              value={
                trend.current === null
                  ? NO_VALUE
                  : `${trend.isExact ? "" : "≈"}${formatNumber(trend.current)}`
              }
              detail={
                trend.handle
                  ? `@${trend.handle}`
                  : trend.current === null
                    ? "not collected yet"
                    : undefined
              }
              change={delta(trend.current, trend.previous, trend.spanDays)}
              // Only when the reading is behind schedule. A platform read
              // minutes ago does not need to say so on a directory page.
              asOf={trend.isStale ? `last read ${timeAgo(trend.checkedAt)}` : undefined}
            />
          );
        })}
      </MetricStrip>
    </div>
  );
}
