import {
  AnalystReportBody,
  Direction,
  HEALTH_LABEL,
  HealthDot,
} from "@/components/dashboard/analyst-report";
import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { currentRole, load } from "@/app/load";
import {
  latestAnalystReport,
  noteHistory,
  recentAnalystRuns,
} from "@/lib/db/queries";
import { METRIC_LABELS_UZ, visibleKeys } from "@/lib/metric-keys";
import { formatDay, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The analyst's daily read of everything else on this dashboard.
 *
 * The report is presented as an argument rather than a verdict: every claim
 * shows the evidence it rests on and how confident the analyst is, and the
 * gaps section is given the same weight as the recommendations. A reader
 * should be able to disagree with it from the page itself.
 */

export default async function AnalystPage() {
  const result = await load(async () => {
    /*
     * IT can open this page as well as the CEO, and a note about the takings is
     * the takings. The keys are filtered by whoever is reading rather than by
     * what the page is for.
     */
    const role = await currentRole();
    const [latest, runs, notes] = await Promise.all([
      latestAnalystReport(),
      recentAnalystRuns(),
      noteHistory(30, { keys: visibleKeys(role) }),
    ]);
    return { latest, runs, notes };
  }, "/analyst");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { latest, runs, notes } = result.data;
  const report = latest?.report ?? null;

  // Runs after the newest good report: a refusal or failure since then is the
  // reason the report below is older than today, and saying so is the point.
  const newerRuns = latest
    ? runs.filter((run) => run.createdAt > latest.createdAt && run.status !== "ok")
    : runs.filter((run) => run.status !== "ok");

  return (
    <div className="space-y-10">
      <PageHeader
        title="Analyst"
        note={
          latest
            ? `Written ${timeAgo(latest.createdAt)} by ${latest.model ?? "the analyst"}, from this dashboard's own numbers.`
            : "A daily read of everything else on this dashboard."
        }
      />

      {!report ? (
        <Empty>
          No report yet. The analyst runs each morning after the daily
          collection; it needs an OpenAI API key to be configured.
        </Empty>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            {latest?.health ? <HealthDot health={latest.health} /> : null}
            <div className="space-y-1">
              <p className="text-lg leading-snug font-medium text-balance">
                {report.headline}
              </p>
              {latest?.health ? (
                <p className="text-muted-foreground text-xs">
                  {HEALTH_LABEL[latest.health]}
                </p>
              ) : null}
            </div>
          </div>

          {newerRuns.length > 0 ? (
            <p className="text-muted-foreground border-l-2 py-1 pl-3 text-xs leading-relaxed">
              {newerRuns.length === 1 ? "A later run" : `${newerRuns.length} later runs`}{" "}
              produced no report
              {newerRuns[0].status === "stale-data"
                ? " because the collectors were failing"
                : ""}
              . The report above is the most recent good one.
            </p>
          ) : null}

          <AnalystReportBody report={report} />

        </>
      )}

      {/*
        The notes the explainer wrote when a figure moved, newest first. In
        Uzbek because that is the language they were written in; translating
        them here would put a second author between the reader and the note.
      */}
      <Section
        title="Metric notes"
        note="written when a figure moved, from the data as it stood that day"
      >
        {notes.length === 0 ? (
          <Empty>
            Nothing yet. A note appears here when one of the tracked figures
            moves far enough to be worth explaining.
          </Empty>
        ) : (
          <ul className="divide-y text-sm">
            {notes.map((note) => (
              <li key={note.id} className="flex gap-2.5 py-3">
                <Direction direction={note.direction} />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {METRIC_LABELS_UZ[note.metricKey]}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDay(note.movementDate)}
                    </span>
                  </div>
                  <p className="leading-relaxed">{note.noteUz}</p>
                  <p className="text-muted-foreground/70 text-xs">{note.magnitude}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/*
        Every past report in full, one click away. The whole report jsonb is
        already fetched by recentAnalystRuns, so it was being thrown away to
        render a headline; expanding costs no extra query.

        Native <details> rather than a client component: this page is server
        rendered, and a disclosure does not need JavaScript shipped to the
        browser to open.
      */}
      {runs.length > 1 ? (
        <Section title="Past runs" note="open one to read it in full">
          <ul className="divide-y text-sm">
            {runs.map((run) => {
              const line = (
                <>
                  <span className="text-muted-foreground w-24 shrink-0 text-xs">
                    {timeAgo(run.createdAt)}
                  </span>
                  {run.health ? <HealthDot health={run.health} /> : null}
                  <span className={cn(run.status !== "ok" && "text-muted-foreground")}>
                    {run.headline ??
                      (run.status === "stale-data"
                        ? "Skipped: collectors were failing"
                        : `Failed: ${run.error ?? "unknown error"}`)}
                  </span>
                </>
              );

              // A run that produced no report has nothing to open, so it stays
              // a flat row rather than an empty disclosure.
              if (run.status !== "ok" || !run.report) {
                return (
                  <li key={run.id} className="flex items-baseline gap-3 py-2">
                    {line}
                  </li>
                );
              }

              return (
                <li key={run.id}>
                  <details className="py-2">
                    <summary className="flex cursor-pointer list-none items-baseline gap-3 marker:content-none hover:opacity-80">
                      {line}
                    </summary>
                    <div className="mt-4 space-y-8 border-l pt-1 pb-2 pl-5">
                      <AnalystReportBody report={run.report} />
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
