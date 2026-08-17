import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { delta, formatDay, formatNumber, timeAgo } from "@/lib/format";
import type { ActiveUsers } from "@/lib/db/queries";

/**
 * Daily, weekly and monthly active users, plus stickiness.
 *
 * These come from the app's own backend rather than from a store, which is
 * why the strip carries its own freshness line. Every other figure on the
 * dashboard is collected by a job we control and whose failures appear in
 * collector health; if the backend's push stops, nothing here breaks and the
 * numbers simply stand still. Saying how old the reading is turns that
 * silence into something visible.
 *
 * The empty state names the actual reason rather than showing dashes, because
 * "no data yet" and "their job stopped" need different people to act.
 */

export function ActiveUsersStrip({ active }: { active: ActiveUsers | null }) {
  if (!active) {
    return (
      <div className="border-b pb-3">
        <h2 className="mb-1 text-sm font-medium">Active users</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Waiting for the first push from the app backend. No store API can
          answer this, so these figures arrive over the ingest endpoint; see
          docs/active-users-ingest.md for the one-time setup.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 className="text-sm font-medium">Active users</h2>
        <span className="text-muted-foreground text-xs">
          {/*
            Two days behind is normal for a job that runs after midnight;
            more than that usually means it stopped, so the wording escalates
            rather than staying neutral.
          */}
          {active.daysBehind > 2
            ? `no push for ${active.daysBehind} days, last read ${timeAgo(active.receivedAt)}`
            : `to ${formatDay(active.date)}, from the app backend`}
        </span>
      </div>

      <MetricStrip>
        <Metric
          label="Daily active"
          value={formatNumber(active.dau)}
          change={delta(active.dau, active.dauPrevious, active.dauSpanDays)}
        />
        <Metric label="Weekly active" value={formatNumber(active.wau)} />
        <Metric
          label="Monthly active"
          value={formatNumber(active.mau)}
          change={delta(active.mau, active.mauPrevious, active.mauSpanDays)}
        />
        <Metric
          label="Stickiness"
          value={active.stickiness === null ? "—" : `${active.stickiness.toFixed(1)}%`}
          detail="daily as a share of monthly"
        />
      </MetricStrip>
    </section>
  );
}
