import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { latestAnalystReport, recentAnalystRuns, type AnalystRow } from "@/lib/db/queries";
import { timeAgo } from "@/lib/format";
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

const HEALTH_LABEL = {
  green: "Growing",
  yellow: "Worth watching",
  red: "Needs attention",
} as const;

/** A dot, not a coloured card. Colour is the only signal it needs to carry. */
function HealthDot({ health }: { health: NonNullable<AnalystRow["health"]> }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        health === "green" && "bg-emerald-500",
        health === "yellow" && "bg-amber-500",
        health === "red" && "bg-rose-500",
      )}
      aria-hidden
    />
  );
}

function Direction({ direction }: { direction: "up" | "down" | "flat" }) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return <Icon className="text-muted-foreground mt-1 size-3.5 shrink-0" aria-hidden />;
}

export default async function AnalystPage() {
  const result = await load(async () => {
    const [latest, runs] = await Promise.all([latestAnalystReport(), recentAnalystRuns()]);
    return { latest, runs };
  });

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { latest, runs } = result.data;
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

          {report.changes.length > 0 ? (
            <Section title="What moved">
              <ul className="space-y-2.5 text-sm">
                {report.changes.map((change, index) => (
                  <li key={index} className="flex gap-2.5">
                    <Direction direction={change.direction} />
                    <span>
                      <span className="font-medium">{change.metric}</span>{" "}
                      <span className="text-muted-foreground">{change.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {report.causes.length > 0 ? (
            <Section title="Why" note="each with the evidence behind it">
              <ul className="space-y-3 text-sm">
                {report.causes.map((cause, index) => (
                  <li key={index}>
                    <div className="flex items-baseline gap-2">
                      <span>{cause.claim}</span>
                      <span className="text-muted-foreground/70 text-xs whitespace-nowrap">
                        {cause.confidence} confidence
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{cause.evidence}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {report.recommendations.length > 0 ? (
            <Section title="Do next" note="ordered by expected value">
              <ol className="space-y-4 text-sm">
                {report.recommendations.map((recommendation, index) => (
                  <li key={index} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                    <span className="text-muted-foreground tnum">{index + 1}.</span>
                    <div>
                      <p className="font-medium">{recommendation.action}</p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {recommendation.why}
                      </p>
                      <p className="text-muted-foreground/70 mt-1 text-xs">
                        {recommendation.expectedImpact} · {recommendation.effort} effort
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}

          {report.competitorWatch.length > 0 ? (
            <Section title="Competitors">
              <ul className="space-y-2 text-sm">
                {report.competitorWatch.map((note, index) => (
                  <li key={index}>
                    <span className="font-medium">{note.app}</span>{" "}
                    <span className="text-muted-foreground">{note.note}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/*
            Given the same weight as the recommendations, deliberately. What
            the analyst could not answer is the standing list of what this
            dashboard should measure next, and burying it would make the
            report look more complete than it is.
          */}
          {report.dataGaps.length > 0 ? (
            <Section title="What this cannot answer" note="the case for the next data source">
              <ul className="text-muted-foreground space-y-1.5 text-sm">
                {report.dataGaps.map((gap, index) => (
                  <li key={index}>{gap}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}

      {runs.length > 1 ? (
        <Section title="Past runs">
          <ul className="divide-y text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex items-baseline gap-3 py-2">
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
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
