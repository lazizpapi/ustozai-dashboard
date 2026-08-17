import Link from "next/link";

import { BrandLogo, type BrandKey } from "@/components/tv/brand-logo";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import {
  iosDiscoveryFunnel,
  latestKeywordRanks,
  recentListingChanges,
  socialTrends,
} from "@/lib/db/queries";
import {
  apostropheNote,
  delta,
  formatDay,
  formatNumber,
  formatPercent,
  rankDelta,
  timeAgo,
} from "@/lib/format";

/**
 * Is acquisition working?
 *
 * The funnel and the audience on one screen, because they are the two halves
 * of the same question: how many people find us, and how many of the ones who
 * look decide to install.
 *
 * The funnel is shown as absolute counts with the rate beside each step
 * rather than as a chart. At four stages a chart adds decoration and loses
 * the numbers, and the rates are what get acted on.
 */

const SOCIAL_LABELS = {
  telegram: "Telegram",
  instagram: "Instagram",
  youtube: "YouTube",
} as const;

const FIELD_LABELS: Record<string, string> = {
  title: "name",
  description: "description",
  version: "version",
  releaseNotes: "release notes",
  screenshots: "screenshots",
  icon: "icon",
};

export async function MarketingView() {
  const result = await load(() =>
    Promise.all([
      refreshAudienceIfStale().then(() => socialTrends()),
      iosDiscoveryFunnel(30),
      latestKeywordRanks("uz"),
      recentListingChanges(12),
    ]),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const [social, funnel, keywords, listingChanges] = result.data;

  const ranked = keywords.filter((row) => row.position !== null);
  // Best positions first; unranked keywords are the work, so they come last
  // rather than being hidden.
  const byPosition = [...keywords].sort((a, b) => {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });

  const steps = funnel
    ? [
        { label: "Impressions", value: funnel.impressions, of: null as number | null },
        { label: "Taps", value: funnel.taps, of: funnel.impressions },
        { label: "Page views", value: funnel.pageViews, of: funnel.impressions },
        { label: "Downloads", value: funnel.firstTimeDownloads, of: funnel.pageViews },
      ]
    : [];

  return (
    <div className="flex min-h-0 flex-col gap-5 lg:h-full">
      <MetricStrip>
        {social.map((trend) => (
          <Metric
            compact
            key={trend.platform}
            href={`/audience/${trend.platform}`}
            icon={<BrandLogo platform={trend.platform as BrandKey} className="size-3.5" />}
            label={SOCIAL_LABELS[trend.platform]}
            value={
              trend.current === null
                ? "—"
                : `${trend.isExact ? "" : "≈"}${formatNumber(trend.current)}`
            }
            detail={trend.isExact ? undefined : "rounded by YouTube"}
            change={delta(trend.current, trend.previous, trend.spanDays)}
            asOf={trend.isStale ? `last read ${timeAgo(trend.capturedAt)}` : undefined}
          />
        ))}

        <Metric
          compact
          label="Keywords ranked"
          value={keywords.length === 0 ? "—" : `${ranked.length}/${keywords.length}`}
          detail={
            keywords.length === 0
              ? "none tracked yet"
              : `${keywords.length - ranked.length} unranked`
          }
        />
      </MetricStrip>

      <div className="grid min-h-0 gap-6 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">App Store discovery</h2>
            <span className="text-muted-foreground text-xs">
              {funnel ? `${formatDay(funnel.from)} to ${formatDay(funnel.to)}` : "last 30 days"}
            </span>
          </div>

          {funnel ? (
            <>
              {/* Spread across the height the view allots rather than
                  bunching at the top over dead space. */}
              <dl className="divide-y lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:justify-around">
                {steps.map((step) => (
                  <div
                    key={step.label}
                    className="flex items-baseline justify-between gap-4 py-2.5"
                  >
                    <dt className="text-muted-foreground text-xs">{step.label}</dt>
                    <dd className="flex items-baseline gap-3">
                      <span className="tnum text-lg font-medium">
                        {formatNumber(step.value)}
                      </span>
                      {step.of !== null ? (
                        <span className="tnum text-muted-foreground w-14 text-right text-xs">
                          {formatPercent(step.value, step.of)}
                        </span>
                      ) : (
                        <span className="w-14" />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground shrink-0 text-xs leading-relaxed">
                Rates are against impressions, except downloads, which are
                against page views: the share of people who looked at the
                listing and installed. Apple restates these for a day or two
                after they land.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No discovery data yet. It arrives with the App Store Connect
              analytics report.
            </p>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">Search positions</h2>
            <Link
              href="/keywords"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              All keywords
            </Link>
          </div>

          {keywords.length === 0 ? (
            <p className="text-muted-foreground text-xs">No keyword readings yet.</p>
          ) : (
            <ul className="min-h-0 divide-y overflow-y-auto">
              {byPosition.slice(0, 9).map((row) => {
                const note = apostropheNote(row.keyword);
                const move = rankDelta(row.position, row.previous);
                return (
                  <li
                    key={row.keyword}
                    className="flex items-baseline justify-between gap-3 py-1.5"
                  >
                    <span className="min-w-0 truncate text-xs">
                      {row.keyword}
                      {note ? (
                        <span className="text-muted-foreground/70 ml-1.5">{note}</span>
                      ) : null}
                    </span>
                    <span className="tnum shrink-0 text-xs">
                      {row.position === null ? (
                        <span className="text-muted-foreground/60">unranked</span>
                      ) : (
                        <>
                          #{row.position}
                          {move.direction === "up" || move.direction === "down" ? (
                            <span className="text-muted-foreground ml-1.5">
                              {move.direction === "up" ? "+" : "-"}
                              {move.magnitude}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
            A competitor editing their title or screenshots is an ASO
            experiment run in public, which makes it marketing intelligence
            rather than a footnote on another page.
          */}
          {listingChanges.length > 0 ? (
            <div className="shrink-0 space-y-1.5 border-t pt-3">
              <h3 className="text-muted-foreground text-xs">Listing edits</h3>
              <ul className="space-y-1">
                {listingChanges.slice(0, 3).map((change) => (
                  <li
                    key={`${change.appId}-${change.detectedAt}`}
                    className="text-muted-foreground text-xs"
                  >
                    <span className="text-foreground">{change.appName}</span> changed{" "}
                    {change.changedFields
                      .map((field) => FIELD_LABELS[field] ?? field)
                      .join(", ")}
                    <span className="text-muted-foreground/70">
                      {" "}
                      {formatDay(change.detectedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
