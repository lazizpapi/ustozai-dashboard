import { AlertTriangle, Check, CircleSlash } from "lucide-react";

import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { collectorHealth, recentAnalystRuns, type SourceHealth } from "@/lib/db/queries";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Is the data sound?
 *
 * The failure mode of this whole dashboard is silence. Both the iTunes feed
 * and the Play payload are undocumented and can stop working without anything
 * throwing where a reader would see it, and a collector that quietly stopped
 * looks exactly like a metric that stopped moving.
 *
 * So this view exists to make the difference visible: every source with its
 * own last-success time, and every analyst run including the ones that
 * refused to write a report. A skipped run is not a failure, and the two are
 * never merged into one count.
 */

function StatusIcon({ status }: { status: string }) {
  if (status === "failed") {
    return <AlertTriangle className="text-status-critical size-3.5 shrink-0" aria-hidden />;
  }
  if (status === "skipped") {
    return <CircleSlash className="text-muted-foreground size-3.5 shrink-0" aria-hidden />;
  }
  return <Check className="text-muted-foreground size-3.5 shrink-0" aria-hidden />;
}

/** Failing first, then skipped, then healthy: the list is a work queue. */
const STATUS_ORDER: Record<string, number> = { failed: 0, skipped: 1 };

function sortForAttention(sources: SourceHealth[]): SourceHealth[] {
  return [...sources].sort((a, b) => {
    const rank = (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
    return rank !== 0 ? rank : a.source.localeCompare(b.source);
  });
}

export async function ItView() {
  const result = await load(() =>
    Promise.all([collectorHealth(), recentAnalystRuns(14)]),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const [health, runs] = result.data;

  const failing = health.filter((source) => source.status === "failed");
  const skipped = health.filter((source) => source.status === "skipped");
  const newest = health.reduce<string | null>(
    (latest, source) => (latest === null || source.ranAt > latest ? source.ranAt : latest),
    null,
  );

  const lastRun = runs[0] ?? null;
  const failedRuns = runs.filter((run) => run.status === "failed").length;

  return (
    <div className="flex min-h-0 flex-col gap-5 lg:h-full">
      <MetricStrip>
        <Metric
          compact
          label="Sources healthy"
          value={health.length === 0 ? "—" : `${health.length - failing.length}/${health.length}`}
          detail={
            health.length === 0
              ? "nothing has run yet"
              : skipped.length > 0
                ? `${skipped.length} skipped by design`
                : undefined
          }
        />

        <Metric
          compact
          label="Last collection"
          value={newest ? timeAgo(newest) : "—"}
          detail={newest ? "across all sources" : undefined}
        />

        <Metric
          compact
          label="Last analyst run"
          value={
            lastRun
              ? lastRun.status === "ok"
                ? "wrote a report"
                : lastRun.status === "stale-data"
                  ? "skipped"
                  : "failed"
              : "—"
          }
          detail={lastRun ? timeAgo(lastRun.createdAt) : "has not run yet"}
        />

        <Metric
          compact
          label="Failed runs"
          value={runs.length === 0 ? "—" : String(failedRuns)}
          detail={runs.length === 0 ? undefined : `of the last ${runs.length}`}
        />
      </MetricStrip>

      <div className="grid min-h-0 gap-6 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">Collectors</h2>
            <span className="text-muted-foreground text-xs">
              {failing.length === 0 ? "all reporting" : "needing attention first"}
            </span>
          </div>

          {health.length === 0 ? (
            <p className="text-muted-foreground text-sm">No collector has run yet.</p>
          ) : (
            <ul className="min-h-0 divide-y overflow-y-auto">
              {sortForAttention(health).map((source) => (
                <li key={source.source} className="flex items-baseline gap-2.5 py-2">
                  <StatusIcon status={source.status} />
                  <span className="min-w-0 flex-1 truncate text-xs">{source.source}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {timeAgo(source.ranAt)}
                  </span>
                  {source.error ? (
                    <span
                      className="text-muted-foreground/70 max-w-[18rem] shrink truncate text-[11px]"
                      title={source.error}
                    >
                      {source.error.split("\n")[0]}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">Analyst runs</h2>
            <span className="text-muted-foreground text-xs">newest first</span>
          </div>

          {runs.length === 0 ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              The analyst has not run yet. It is scheduled each morning after
              the daily collection.
            </p>
          ) : (
            <ul className="min-h-0 divide-y overflow-y-auto">
              {runs.map((run) => (
                <li key={run.id} className="flex items-baseline gap-2 py-2">
                  <span className="text-muted-foreground w-16 shrink-0 text-[11px]">
                    {timeAgo(run.createdAt)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-xs leading-snug",
                      run.status !== "ok" && "text-muted-foreground",
                    )}
                  >
                    {run.status === "ok"
                      ? (run.headline ?? "wrote a report")
                      : run.status === "stale-data"
                        ? "Skipped: the collectors were failing"
                        : `Failed: ${run.error ?? "unknown error"}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
