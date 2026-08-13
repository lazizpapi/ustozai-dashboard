import { AlertTriangle, Check, CircleSlash } from "lucide-react";

import { timeAgo } from "@/lib/format";
import type { SourceHealth } from "@/lib/db/queries";

/**
 * Collector health.
 *
 * This exists because the failure mode of this dashboard is silence. Both the
 * iTunes RSS and the Play payload are undocumented and can stop working without
 * anything throwing where a user would see it. A chart that quietly stops
 * updating looks exactly like a metric that stopped moving, so freshness is
 * shown next to the data rather than buried on a status page.
 *
 * Status is never colour alone: every state carries an icon and a word.
 */

function statusIcon(status: string) {
  if (status === "failed") {
    return <AlertTriangle className="text-status-critical size-3.5" aria-hidden />;
  }
  if (status === "skipped") {
    return <CircleSlash className="text-muted-foreground size-3.5" aria-hidden />;
  }
  return <Check className="text-muted-foreground size-3.5" aria-hidden />;
}

export function FreshnessRow({ sources }: { sources: SourceHealth[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No collector has run yet.
      </p>
    );
  }

  const failing = sources.filter((source) => source.status === "failed");
  const newest = sources.reduce<string | null>(
    (latest, source) => (latest === null || source.ranAt > latest ? source.ranAt : latest),
    null,
  );

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        {failing.length === 0 ? (
          <>
            {statusIcon("ok")}
            <span>All {sources.length} sources healthy, last run {timeAgo(newest)}</span>
          </>
        ) : (
          <>
            {statusIcon("failed")}
            <span className="text-foreground">
              {failing.length} of {sources.length} sources failing
            </span>
          </>
        )}
      </p>

      {failing.length > 0 ? (
        <ul className="space-y-1.5">
          {failing.slice(0, 6).map((source) => (
            <li key={source.source} className="flex items-start gap-2 text-xs">
              {statusIcon(source.status)}
              <span className="tnum text-foreground">{source.source}</span>
              <span className="text-muted-foreground">
                failed {timeAgo(source.ranAt)}
                {source.error ? `: ${source.error.split("\n")[0].slice(0, 90)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Small inline stamp for a single panel. */
export function AsOf({ iso, prefix = "updated" }: { iso: string | null; prefix?: string }) {
  return (
    <span className="text-muted-foreground/70 text-[11px]">
      {prefix} {timeAgo(iso)}
    </span>
  );
}
