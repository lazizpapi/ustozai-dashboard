import Link from "next/link";
import { notFound } from "next/navigation";

import { APP_STORE_MARK, GOOGLE_PLAY_MARK } from "@/components/tv/brand-logo";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { PageHeader, Section } from "@/components/dashboard/page-header";
import { RankChart } from "@/components/dashboard/rank-chart";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { VelocityChart } from "@/components/dashboard/velocity-chart";
import { load } from "@/app/load";
import { competitorProfile } from "@/lib/db/queries";
import { COMPETITORS } from "@/lib/collectors/config";
import { formatDay, formatNumber, formatRating, formatSigned, NO_VALUE} from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Everything the stores will tell us about one app, ours included.
 *
 * The market table ranks everyone on today's figures. This is the drill-down
 * behind a row: how that app got where it is, and what it has been changing.
 *
 * The hard part of this page is not the charts, it is the labels. A reader
 * wants "their downloads", and the honest answer differs per store:
 *
 * Google publishes a cumulative install total and updates it in batches, so
 * installs per day here is that total differenced over a trailing window. A
 * real quantity over real days, not an estimate.
 *
 * Apple publishes nothing about a competitor's downloads at any granularity.
 * The nearest public signal is how fast their rating count grows, and that is
 * what this shows, under its own name. It only tracks demand while the share
 * of users who bother to rate stays steady, which the page says out loud
 * rather than leaving to be assumed.
 */

const SLUGS = ["ustoz-ai", ...COMPETITORS.map((c) => c.slug)];

const FIELD_LABELS: Record<string, string> = {
  title: "name",
  description: "description",
  version: "version",
  releaseNotes: "release notes",
  screenshots: "screenshots",
  icon: "icon",
};

const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** The plain-text value of a listing field, when it is a string. */
function textField(
  listings: { fields: Record<string, string | string[] | null> }[],
  key: string,
): string | null {
  for (const listing of listings) {
    const value = listing.fields[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

/** Average of the last few points, so a headline rate is not one noisy day. */
function recentAverage(points: { perDay: number }[], take = 7): number | null {
  if (points.length === 0) return null;
  const slice = points.slice(-take);
  return Math.round(slice.reduce((sum, point) => sum + point.perDay, 0) / slice.length);
}

export default async function CompetitorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // A 404 rather than a redirect, for the same reason as the audience pages:
  // a mistyped address is a wrong address, and silently landing elsewhere
  // hides the mistake.
  if (!SLUGS.includes(slug)) notFound();

  const result = await load(() => competitorProfile(slug), "/market");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const app = result.data;
  if (!app) notFound();

  const installRate = recentAverage(app.playVelocity);
  const ratingRate = recentAverage(app.iosRatingVelocity);
  const latestInstalls = app.playInstalls.at(-1)?.value ?? null;
  const description = textField(app.listings, "description");
  const version = textField(app.listings, "version");

  return (
    <div className="space-y-8">
      <PageHeader
        title={app.name}
        note={
          app.isOurs
            ? "Our own app, shown the same way as everyone we track."
            : "A tracked competitor, from public store data only."
        }
      />

      <div className="flex flex-wrap items-center gap-4 text-xs">
        {app.iosId ? (
          <a
            href={`https://apps.apple.com/uz/app/id${app.iosId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            App Store listing
          </a>
        ) : null}
        {app.androidPackage ? (
          <a
            href={`https://play.google.com/store/apps/details?id=${app.androidPackage}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Google Play listing
          </a>
        ) : null}
        {version ? (
          <span className="text-muted-foreground">Version {version}</span>
        ) : null}
        <Link
          href="/market"
          className="text-muted-foreground hover:text-foreground ml-auto transition-colors"
        >
          Back to the market
        </Link>
      </div>

      <MetricStrip>
        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play installs / day"
          value={installRate === null ? NO_VALUE : formatSigned(installRate)}
          detail={installRate === null ? "needs two days of readings" : "recent average"}
        />
        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play installs, total"
          value={formatNumber(latestInstalls)}
          detail="as Google publishes it"
        />
        <Metric
          icon={APP_STORE_MARK}
          label="App Store rating"
          value={formatRating(app.iosRating)}
          detail={
            app.iosRatingCount === null
              ? undefined
              : `${formatNumber(app.iosRatingCount)} ratings`
          }
        />
        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play rating"
          value={formatRating(app.playRating)}
          detail={
            app.playRatingCount === null
              ? undefined
              : `${formatNumber(app.playRatingCount)} ratings`
          }
        />
      </MetricStrip>

      <Section
        title="Install velocity"
        note="Google's published total, differenced over a trailing week"
      >
        <VelocityChart
          points={app.playVelocity}
          noun="installs"
          emptyNote="Not enough Play readings yet. Two days of history draws the first point."
        />
      </Section>

      <Section
        title="App Store demand"
        note="new ratings per day, which is a proxy and not a download count"
      >
        <VelocityChart
          points={app.iosRatingVelocity}
          noun="ratings"
          emptyNote="Not enough App Store readings yet."
        />
        <p className="text-muted-foreground mt-2 max-w-2xl text-xs leading-relaxed">
          Apple publishes no competitor download figures at any granularity, so
          nobody outside Apple has them. How fast an app collects ratings is
          the closest public signal, and it only tracks demand while the share
          of users who rate stays steady. Read it as direction, not as volume.
          {ratingRate !== null
            ? ` Recently about ${formatNumber(ratingRate)} new ratings a day.`
            : ""}
        </p>
      </Section>

      {app.rankHistory.length > 0 ? (
        <Section title="Chart position" note="Education, top free, iPhone, Uzbekistan">
          <RankChart points={app.rankHistory} />
        </Section>
      ) : null}

      <Section
        title="Listing changes"
        note="store page edits, which is an ASO experiment run in public"
      >
        {app.listingChanges.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {app.listingChanges.slice(0, 12).map((change) => (
              <li
                key={`${change.appId}-${change.detectedAt}`}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <span className="text-muted-foreground tnum text-xs">
                  {formatDay(change.detectedAt)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {change.platform === "ios" ? "App Store" : "Google Play"}
                </span>
                <span>changed {change.changedFields.map(fieldLabel).join(", ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            Nothing changed since we started watching this listing. The baseline
            itself is not a change, so it does not appear here.
          </p>
        )}
      </Section>

      {description ? (
        <Section title="Current store description" note="what they say they are">
          <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed whitespace-pre-line">
            {description.slice(0, 1200)}
            {description.length > 1200 ? "…" : ""}
          </p>
        </Section>
      ) : null}
    </div>
  );
}
