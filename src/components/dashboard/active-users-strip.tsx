import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { delta, formatDay, formatNumber, timeAgo } from "@/lib/format";
import type {
  ActiveUsers,
  EngagementSummary,
  RevenueSummary,
} from "@/lib/db/queries";

/**
 * What the product itself is doing: active users, engagement and takings.
 *
 * Every figure here comes from UstozAI's own admin API rather than from a
 * store, so the strip carries its own freshness line. The API restates recent
 * days, and if it stops answering nothing breaks visibly: the numbers simply
 * stand still. Saying how old the newest day is turns that silence into
 * something a reader can see.
 *
 * Views sit beside active users under a label that says what they are not.
 * The API document calls that endpoint the DAU chart while it returns a
 * figure roughly twenty-five times larger, and the two side by side is
 * exactly where somebody would otherwise read one as the other.
 *
 * The empty state names the actual reason rather than showing dashes, because
 * "not configured yet" and "collection stopped" need different people to act.
 */

interface Props {
  active: ActiveUsers | null;
  revenue?: RevenueSummary;
  engagement?: EngagementSummary | null;
}

export function ActiveUsersStrip({ active, revenue, engagement }: Props) {
  if (!active) {
    return (
      <div className="border-b pb-3">
        <h2 className="mb-1 text-sm font-medium">Product and revenue</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Nothing collected yet. No store API reports active users, session
          length or takings, so these come from UstozAI&apos;s own admin API;
          set USTOZ_API_BASE_URL and they appear on the next hourly poll.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 className="text-sm font-medium">Product and revenue</h2>
        <span className="text-muted-foreground text-xs">
          {/*
            Two days behind is normal for a job that runs after midnight;
            more than that usually means it stopped, so the wording escalates
            rather than staying neutral.
          */}
          {active.daysBehind > 2
            ? `nothing collected for ${active.daysBehind} days, last read ${timeAgo(active.receivedAt)}`
            : `to ${formatDay(active.date)}, from the app's own API`}
        </span>
      </div>

      <MetricStrip wide>
        <Metric
          label="Daily active"
          value={formatNumber(active.dau)}
          change={delta(active.dau, active.dauPrevious, active.dauSpanDays)}
        />
        <Metric
          label="Views, daily"
          value={engagement?.views == null ? "—" : formatNumber(engagement.views)}
          detail="not active users, an order of magnitude larger"
          change={delta(
            engagement?.views ?? null,
            engagement?.viewsPrevious ?? null,
            engagement?.viewsSpanDays ?? null,
          )}
        />
        <Metric
          label="Average session"
          value={
            engagement?.averageMinutes == null
              ? "—"
              : `${engagement.averageMinutes.toFixed(1)}m`
          }
          detail={
            engagement?.totalLogins == null
              ? undefined
              : `${formatNumber(engagement.totalLogins)} logins`
          }
        />
        {/* Revenue links through to the page that explains the unit caveat
            rather than repeating it in a strip this dense. */}
        <Metric
          href="/business"
          label="Takings, latest day"
          value={revenue?.latest ? formatNumber(revenue.latest.amount) : "—"}
          detail={
            revenue?.latest
              ? `${formatNumber(revenue.latest.transactions)} transactions`
              : undefined
          }
          change={delta(
            revenue?.latest?.amount ?? null,
            revenue?.previous ?? null,
            revenue?.spanDays ?? null,
          )}
          asOf={revenue?.latest ? `on ${formatDay(revenue.latest.date)}` : undefined}
        />
        <Metric
          href="/business"
          label="Takings, 30 days"
          value={revenue ? formatNumber(revenue.windowTotal) : "—"}
          detail="as the payment API reports it"
        />
        <Metric
          label="Top provider"
          value={revenue?.byProvider[0]?.provider ?? "—"}
          detail={
            revenue && revenue.byProvider.length > 1
              ? `${revenue.byProvider.length} providers taking payment`
              : undefined
          }
        />
      </MetricStrip>
    </section>
  );
}
