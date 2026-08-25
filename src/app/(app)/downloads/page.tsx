import { PageHeader, Section } from "@/components/dashboard/page-header";
import { DownloadsChart } from "@/components/dashboard/downloads-chart";
import { APP_STORE_MARK, GOOGLE_PLAY_MARK } from "@/components/tv/brand-logo";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import {
  androidDailyInstalls,
  iosDailyDownloads,
  iosDiscoveryFunnel,
  iosProceeds,
  ownReleases,
  snapshotHistory,
} from "@/lib/db/queries";
import { delta, formatDay, formatNumber, formatPercent, NO_VALUE} from "@/lib/format";

export const dynamic = "force-dynamic";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export default async function DownloadsPage() {
  const result = await load(async () => {
    const [ios, android, androidSnapshots, funnel, proceeds, releases] = await Promise.all([
      iosDailyDownloads(60),
      androidDailyInstalls(60),
      snapshotHistory("android", "uz", 60),
      iosDiscoveryFunnel(30),
      iosProceeds(30),
      ownReleases(60),
    ]);
    return { ios, android, androidSnapshots, funnel, proceeds, releases };
  }, "/downloads");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { ios, android, androidSnapshots, funnel, proceeds, releases } = result.data;

  const iosLast7 = sum(ios.slice(-7).map((row) => row.downloads));
  const iosPrior7 = sum(ios.slice(-14, -7).map((row) => row.downloads));
  const androidLast7 = sum(android.slice(-7).map((row) => row.installs));
  const androidPrior7 = sum(android.slice(-14, -7).map((row) => row.installs));

  const cumulative = androidSnapshots.at(-1);

  return (
    <div className="space-y-12">
      <PageHeader
        title="Downloads"
        note="Never live. Apple publishes a day behind; Play is a running total."
      />

      <MetricStrip>
        <Metric
          icon={APP_STORE_MARK}
          label="App Store, last 7 days"
          value={ios.length ? formatNumber(iosLast7) : NO_VALUE}
          detail={ios.length ? undefined : "App Store Connect not connected"}
          change={ios.length >= 14 ? delta(iosLast7, iosPrior7) : undefined}
        />
        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play, last 7 days"
          value={android.length ? formatNumber(androidLast7) : NO_VALUE}
          detail={android.length ? undefined : "needs two days of snapshots"}
          change={android.length >= 14 ? delta(androidLast7, androidPrior7) : undefined}
        />
        <Metric
          icon={GOOGLE_PLAY_MARK}
          label="Google Play installs, all time"
          value={
            cumulative?.installCount !== null && cumulative?.installCount !== undefined
              ? formatNumber(cumulative.installCount)
              : NO_VALUE
          }
          detail={cumulative?.installLabel ? `Play shows ${cumulative.installLabel}` : undefined}
        />
        {/*
          The label names whichever store the date came from. It used to read
          "Latest day recorded" for a value that falls back from Apple to Play,
          so the same tile meant a different store depending on what had
          arrived, and never said which.
        */}
        <Metric
          icon={ios.at(-1) ? APP_STORE_MARK : android.at(-1) ? GOOGLE_PLAY_MARK : undefined}
          label={
            ios.at(-1)
              ? "Latest App Store day"
              : android.at(-1)
                ? "Latest Google Play day"
                : "Latest day recorded"
          }
          value={
            ios.at(-1)
              ? formatDay(ios.at(-1)!.date)
              : android.at(-1)
                ? formatDay(android.at(-1)!.date)
                : NO_VALUE
          }
          detail="most recent closed day"
        />
      </MetricStrip>

      {/*
        The funnel, and only once Apple has produced rows for it. An empty
        conversion panel would be four dashes teaching people to ignore this
        part of the page; absent, it simply appears the day there is something
        to say.

        Four figures rather than five: the two rates belong to the stages they
        describe, so each sits as the qualifier under its own stage. Reading
        left to right then gives how many saw it, how many opened it and at
        what rate, how many installed and at what rate.
      */}
      {funnel ? (
        <Section
          title="Conversion"
          note={`${formatDay(funnel.from)} to ${formatDay(funnel.to)}, App Store only, ${formatPercent(funnel.firstTimeDownloads, funnel.impressions)} end to end`}
        >
          <MetricStrip>
            <Metric label="Impressions" value={formatNumber(funnel.impressions)} detail="saw the listing" />
            <Metric
              label="Taps"
              value={formatNumber(funnel.taps)}
              detail={`${formatPercent(funnel.taps, funnel.impressions)} of impressions`}
            />
            <Metric
              label="Page views"
              value={formatNumber(funnel.pageViews)}
              detail={`${formatPercent(funnel.pageViews, funnel.taps)} of taps`}
            />
            <Metric
              label="First-time downloads"
              value={formatNumber(funnel.firstTimeDownloads)}
              detail={`${formatPercent(funnel.firstTimeDownloads, funnel.pageViews)} of page views`}
            />
          </MetricStrip>
        </Section>
      ) : null}

      {/*
        Apple money, on the same terms as the funnel above: present only once
        there is some. The app is free and takes payment through Payme and
        Click, so Apple owes nothing today and an empty panel would be four
        zeroes teaching people to skip this part of the page. It appears by
        itself the day an in-app purchase is sold.
      */}
      {proceeds.length > 0 ? (
        <Section
          title="App Store proceeds"
          note={`${formatDay(proceeds[0].from)} to ${formatDay(proceeds[0].to)}, after Apple\u2019s commission`}
        >
          <MetricStrip>
            {proceeds.map((total) => (
              <Metric
                key={total.currency}
                icon={APP_STORE_MARK}
                label={`Proceeds, ${total.currency}`}
                value={total.proceeds.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                detail={`from ${formatNumber(total.units)} paid ${
                  total.units === 1 ? "unit" : "units"
                }`}
              />
            ))}
          </MetricStrip>
        </Section>
      ) : null}

      <Section title="Daily installs" note="last 60 days, one shared axis">
        <DownloadsChart ios={ios} android={android} markers={releases} />
      </Section>
    </div>
  );
}
