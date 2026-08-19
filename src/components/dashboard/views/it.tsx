import { AlertTriangle, Check, CircleSlash } from "lucide-react";

import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { collectorHealth, recentAnalystRuns, type SourceHealth } from "@/lib/db/queries";
import { timeAgo, NO_VALUE} from "@/lib/format";
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
    <div className="space-y-8">
      <MetricStrip>
        <Metric
          label="Sources healthy"
          value={health.length === 0 ? NO_VALUE : `${health.length - failing.length}/${health.length}`}
          detail={
            health.length === 0
              ? "nothing has run yet"
              : skipped.length > 0
                ? `${skipped.length} skipped by design`
                : undefined
          }
        />

        <Metric
          label="Last collection"
          value={newest ? timeAgo(newest) : NO_VALUE}
          detail={newest ? "across all sources" : undefined}
        />

        <Metric
          label="Last analyst run"
          value={
            lastRun
              ? lastRun.status === "ok"
                ? "wrote a report"
                : lastRun.status === "stale-data"
                  ? "skipped"
                  : "failed"
              : NO_VALUE
          }
          detail={lastRun ? timeAgo(lastRun.createdAt) : "has not run yet"}
        />

        <Metric
          label="Failed runs"
          value={runs.length === 0 ? NO_VALUE : String(failedRuns)}
          detail={runs.length === 0 ? undefined : `of the last ${runs.length}`}
        />
      </MetricStrip>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Section title="Collectors" note={failing.length === 0 ? "all reporting" : "needing attention first"}>
{health.length === 0 ? (
            <p className="text-muted-foreground text-sm">No collector has run yet.</p>
          ) : (
            <ul className="divide-y">
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
        </Section>

        <Section title="Analyst runs" note="newest first">
{runs.length === 0 ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              The analyst has not run yet. It is scheduled each morning after
              the daily collection.
            </p>
          ) : (
            <ul className="divide-y">
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
        </Section>
      </div>
    </div>
  );
}
