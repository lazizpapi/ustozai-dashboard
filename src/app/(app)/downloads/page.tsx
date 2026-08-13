import { PageHeader, Section } from "@/components/dashboard/page-header";
import { DownloadsChart } from "@/components/dashboard/downloads-chart";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import {
  androidDailyInstalls,
  iosDailyDownloads,
  snapshotHistory,
} from "@/lib/db/queries";
import { delta, formatDay, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export default async function DownloadsPage() {
  const result = await load(async () => {
    const [ios, android, androidSnapshots] = await Promise.all([
      iosDailyDownloads(60),
      androidDailyInstalls(60),
      snapshotHistory("android", "uz", 60),
    ]);
    return { ios, android, androidSnapshots };
  });

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { ios, android, androidSnapshots } = result.data;

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

      <Section title="Daily installs" note="last 60 days, one shared axis">
        <DownloadsChart ios={ios} android={android} />
      </Section>
    </div>
  );
}
