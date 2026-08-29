import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Section } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";
import type { AnalystReport } from "@/lib/analyst/schema";

/**
 * One analyst report, rendered.
 *
 * Extracted from the page because it is now drawn twice: once for this
 * morning's report, and once inside each past run somebody expands. It was
 * inline JSX when only the newest report was ever shown, and the whole reason
 * the history was a list of headlines is that nothing could render the rest.
 *
 * A server component with no state. Every section is conditional on having
 * something to say, so an empty one leaves no heading behind.
 */

export const HEALTH_LABEL = {
  green: "Growing",
  yellow: "Worth watching",
  red: "Needs attention",
} as const;

/** A dot, not a coloured card. Colour is the only signal it needs to carry. */
export function HealthDot({ health }: { health: keyof typeof HEALTH_LABEL }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        health === "green" && "bg-status-ok",
        health === "yellow" && "bg-status-warn",
        health === "red" && "bg-status-critical",
      )}
      aria-hidden
    />
  );
}

export function Direction({ direction }: { direction: "up" | "down" | "flat" }) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  return <Icon className="text-muted-foreground mt-1 size-3.5 shrink-0" aria-hidden />;
}

export function AnalystReportBody({ report }: { report: AnalystReport }) {
  return (
    <>
      {/*
        First, above what moved today, because it is the only part of the
        report that answers for itself. A recommendation nobody ever revisits
        costs the reader attention every morning and never has to be right.

        Optional on purpose: every report written before this existed is still
        in the table, and those are perfectly good reports.
      */}
      {report.followUp && report.followUp.length > 0 ? (
        <Section title="Since last time" note="what became of the last report's advice">
          <ul className="space-y-3 text-sm">
            {report.followUp.map((entry, index) => (
              <li key={index}>
                <p className="font-medium">{entry.action}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">{entry.outcome}</p>
              </li>
            ))}
          </ul>
        </Section>
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
        Given the same weight as the recommendations, deliberately. What the
        analyst could not answer is the standing list of what this dashboard
        should measure next, and burying it would make the report look more
        complete than it is.
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
  );
}
