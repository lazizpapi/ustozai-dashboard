import { PageHeader, Section } from "@/components/dashboard/page-header";
import { DownloadsChart } from "@/components/dashboard/downloads-chart";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import {
  androidDailyInstalls,
  iosDailyDownloads,
  iosDiscoveryFunnel,
  snapshotHistory,
} from "@/lib/db/queries";
import { delta, formatDay, formatNumber, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export default async function DownloadsPage() {
  const result = await load(async () => {
    const [ios, android, androidSnapshots, funnel] = await Promise.all([
      iosDailyDownloads(60),
      androidDailyInstalls(60),
      snapshotHistory("android", "uz", 60),
      iosDiscoveryFunnel(30),
    ]);
    return { ios, android, androidSnapshots, funnel };
  }, "/downloads");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { ios, android, androidSnapshots, funnel } = result.data;

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
          label="App Store, last 7 days"
          value={ios.length ? formatNumber(iosLast7) : "—"}
          detail={ios.length ? undefined : "App Store Connect not connected"}
          change={ios.length >= 14 ? delta(iosLast7, iosPrior7) : undefined}
        />
        <Metric
          label="Google Play, last 7 days"
          value={android.length ? formatNumber(androidLast7) : "—"}
          detail={android.length ? undefined : "needs two days of snapshots"}
          change={android.length >= 14 ? delta(androidLast7, androidPrior7) : undefined}
        />
        <Metric
          label="Play installs, all time"
          value={
            cumulative?.installCount !== null && cumulative?.installCount !== undefined
              ? formatNumber(cumulative.installCount)
              : "—"
          }
          detail={cumulative?.installLabel ? `Play shows ${cumulative.installLabel}` : undefined}
        />
        <Metric
          label="Latest day recorded"
          value={
            ios.at(-1)
              ? formatDay(ios.at(-1)!.date)
              : android.at(-1)
                ? formatDay(android.at(-1)!.date)
                : "—"
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

      <Section title="Daily installs" note="last 60 days, one shared axis">
        <DownloadsChart ios={ios} android={android} />
      </Section>
    </div>
  );
}
