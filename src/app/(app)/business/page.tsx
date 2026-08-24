import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { PageHeader, Section } from "@/components/dashboard/page-header";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { activeUsersTrend, engagementSummary, revenueSummary } from "@/lib/db/queries";
import { ustozApiProblem } from "@/lib/env";
import { delta, formatDay, formatNumber, NO_VALUE} from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * What the app earns, and who is using it.
 *
 * CEO only. Everything here comes from UstozAI's own admin API rather than
 * from a store, and it is the one page a department password must never
 * unlock: separating the departments would mean little if any of them could
 * read the company's takings.
 *
 * Amounts are printed in som. Payme and Click report in tiyin, so revenueSummary
 * divides by a hundred on the way out and everything here is already scaled; the
 * unit was confirmed with the company rather than guessed from the size of the
 * number. The footnote names the unit rather than leaving a reader to assume.
 */

export default async function BusinessPage() {
  const result = await load(
    () => Promise.all([revenueSummary(60), engagementSummary(60), activeUsersTrend()]),
    "/business",
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const [revenue, engagement, active] = result.data;
  const configProblem = ustozApiProblem();

  if (revenue.daily.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Business" note="Revenue and engagement, from the app's own API." />
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          {configProblem
            ? `Not collecting yet: ${configProblem}. Set USTOZ_API_BASE_URL and the figures appear on the next hourly poll.`
            : "No takings recorded yet. The next hourly poll reads the last week, so a gap repairs itself."}
        </p>
      </div>
    );
  }

  const days = revenue.daily.length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Business"
        note={`Takings and engagement over the last ${days} days, from the app's own API.`}
      />

      <MetricStrip>
        <Metric
          label="Takings, latest day"
          value={revenue.latest ? formatNumber(revenue.latest.amount) : NO_VALUE}
          detail={
            revenue.latest
              ? `${formatNumber(revenue.latest.transactions)} transactions`
              : undefined
          }
          change={delta(revenue.latest?.amount ?? null, revenue.previous, revenue.spanDays)}
          asOf={revenue.latest ? `on ${formatDay(revenue.latest.date)}` : undefined}
        />
        <Metric
          label={`Takings, ${days} days`}
          value={formatNumber(revenue.windowTotal)}
          detail="som, converted from the API's tiyin"
        />
        <Metric
          label="Daily active"
          value={active?.dau == null ? NO_VALUE : formatNumber(active.dau)}
          detail={active ? `to ${formatDay(active.date)}` : undefined}
        />
        <Metric
          label="Average session"
          value={
            engagement?.averageMinutes === null || engagement === null
              ? NO_VALUE
              : `${engagement.averageMinutes.toFixed(1)}m`
          }
          detail={
            engagement?.totalLogins === null || engagement === null
              ? undefined
              : `${formatNumber(engagement.totalLogins)} logins`
          }
        />
      </MetricStrip>

      <Section title="Takings per day" note="the API's own day total, not a sum of providers">
        <RevenueChart points={revenue.daily} />
      </Section>

      {revenue.byProvider.length > 0 ? (
        <Section
          title="By payment provider"
          note={`over the last ${days} days`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="px-3 py-2 text-left font-medium">Provider</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Transactions</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {revenue.byProvider.map((row) => {
                  const total = revenue.byProvider.reduce((sum, p) => sum + p.amount, 0);
                  return (
                    <tr key={row.provider} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{row.provider}</td>
                      <td className="tnum px-3 py-2 text-right">{formatNumber(row.amount)}</td>
                      <td className="tnum px-3 py-2 text-right">
                        {formatNumber(row.transactions)}
                      </td>
                      <td className="tnum text-muted-foreground px-3 py-2 text-right">
                        {total > 0 ? `${((row.amount / total) * 100).toFixed(1)}%` : NO_VALUE}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        Amounts are in som. Payme and Click both report in tiyin, so every
        figure here is the API&apos;s value divided by a hundred. The day total
        is the API&apos;s own rather than a sum of the providers beneath it, so
        the two can be compared instead of assumed equal.
      </p>
    </div>
  );
}
