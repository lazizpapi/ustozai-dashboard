import type { AnalystRow } from "@/lib/db/queries";
import { localDate } from "@/lib/growth";

/**
 * When the daily report stops being written.
 *
 * Everything that reads "the latest report" is given the newest successful
 * one, on purpose: a failed run should not blank the page. The price is that
 * a run of failures hides behind an old report. From 27 September 2026 the
 * OpenAI account had no credits, every run failed for nineteen days, and
 * Jarvis's morning briefing went on quoting the report of 26 September as the
 * latest. Nobody noticed.
 *
 * So the age of a report travels with it (reportWithFreshness), and the team
 * chat hears about a run of failures (notifyOutage), on the second day in a
 * row and then once a week while it lasts.
 */

export type RunSummary = Pick<AnalystRow, "createdAt" | "status" | "error">;

export type ReportOutage = {
  /** Days in a row whose runs wrote no report, counting each day once. */
  failedDays: number;
  /** The first of those days, YYYY-MM-DD in Tashkent. */
  since: string;
  /** The day of the last report written, when it is among the runs read. */
  lastWritten: string | null;
  /** Why, in words the team chat and Jarvis can say. */
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ERROR_CHARS = 120;
const ALERT_FIRST_DAY = 2;
const ALERT_EVERY_DAYS = 7;

const SPOKEN_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "Thursday 1 October", for a YYYY-MM-DD day. */
export function spokenDay(day: string): string {
  return SPOKEN_DAY.format(new Date(`${day}T12:00:00Z`)).replace(",", "");
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What went wrong with a run, as a clause that follows a colon. */
export function runReason(run: RunSummary): string {
  const error = run.error ?? "";
  if (run.status === "stale-data") {
    const sources = error.replace(/^collectors failing:\s*/i, "").trim();
    return `data collectors were failing${sources ? ` (${sources})` : ""}, so it refused to write from bad numbers`;
  }
  if (/no credits|insufficient_quota|exceeded your current quota/i.test(error)) {
    return "the OpenAI account has run out of credits";
  }
  const firstLine = error.split("\n")[0]?.trim().slice(0, MAX_ERROR_CHARS) ?? "";
  return firstLine ? `the last attempt failed with: ${firstLine}` : "the last attempt failed without saying why";
}

/** The current run of days without a report, from runs newest first; null while the newest run wrote one. */
export function reportOutage(runsNewestFirst: readonly RunSummary[]): ReportOutage | null {
  const newest = runsNewestFirst[0];
  if (!newest || newest.status === "ok") return null;

  const streak: RunSummary[] = [];
  let lastWritten: string | null = null;
  for (const run of runsNewestFirst) {
    if (run.status === "ok") {
      lastWritten = localDate(run.createdAt);
      break;
    }
    streak.push(run);
  }

  // A day that had a report is not a day without one, even when a run by hand
  // failed later that day.
  const days = [...new Set(streak.map((run) => localDate(run.createdAt)))].filter(
    (day) => day !== lastWritten,
  );
  if (days.length === 0) return null;
  return {
    failedDays: days.length,
    since: days[days.length - 1],
    lastWritten,
    reason: runReason(newest),
  };
}

/** Whether the newest run is the first that day to write no report. */
function firstFailureOfItsDay(runsNewestFirst: readonly RunSummary[]): boolean {
  const newest = runsNewestFirst[0];
  if (!newest) return false;
  const day = localDate(newest.createdAt);
  return runsNewestFirst.filter((run) => run.status !== "ok" && localDate(run.createdAt) === day).length === 1;
}

/** When a report was written, and how many Tashkent days ago. */
export function reportAge(createdAt: string, now: Date): { writtenOn: string; ageDays: number } {
  const writtenOn = localDate(createdAt);
  const today = localDate(now.toISOString());
  return { writtenOn, ageDays: Math.round((Date.parse(today) - Date.parse(writtenOn)) / DAY_MS) };
}

/** Older than this, a report is out of date: yesterday's is current until today's run. */
export const STALE_AFTER_DAYS = 2;

/** On the second day in a row without a report, then once a week. */
export function shouldAlert(outage: ReportOutage): boolean {
  const past = outage.failedDays - ALERT_FIRST_DAY;
  return past >= 0 && past % ALERT_EVERY_DAYS === 0;
}

/** The team chat's message: what stopped, since when, and what is shown instead. HTML. */
export function outageMessage(outage: ReportOutage, url?: string): string {
  return [
    `🔴 <b>The daily report has failed ${outage.failedDays} days in a row</b>`,
    `Since ${spokenDay(outage.since)}: ${escape(outage.reason)}.`,
    ...(outage.lastWritten
      ? [`The dashboard and Jarvis are still showing the report of ${spokenDay(outage.lastWritten)}.`]
      : []),
    ...(url ? [url] : []),
  ].join("\n");
}

/**
 * Tell the team chat, when today is a day to. Called after a run that wrote no
 * report. Never throws: the run has already been recorded, and a missed alert
 * must not turn into a failed job.
 */
export async function notifyOutage(deps: {
  /** A run started by hand (?silent=1) posts nothing, as with the report itself. */
  silent: boolean;
  recentRuns: () => Promise<RunSummary[]>;
  send: (text: string) => Promise<{ sent: boolean; reason?: string }>;
  url?: string;
}): Promise<{ sent: boolean; reason?: string } | null> {
  if (deps.silent) return null;
  try {
    const runs = await deps.recentRuns();
    const outage = reportOutage(runs);
    // Once a day: a second run on an alert day, by hand, does not post again.
    if (!outage || !shouldAlert(outage) || !firstFailureOfItsDay(runs)) return null;
    return await deps.send(outageMessage(outage, deps.url));
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function outageSentence(outage: ReportOutage): string {
  return outage.failedDays === 1
    ? `The latest run, on ${spokenDay(outage.since)}, failed: ${outage.reason}.`
    : `The last ${outage.failedDays} daily runs, since ${spokenDay(outage.since)}, all failed: ${outage.reason}.`;
}

/**
 * The latest report with its age, and a note for whoever reads it out when it
 * is older than yesterday's or the runs since have failed. Jarvis passes on a
 * result's note (its prompt says so), which is what makes it say the date.
 */
export function reportWithFreshness(
  report: AnalystRow | null,
  runsNewestFirst: readonly RunSummary[],
  now: Date,
): Record<string, unknown> {
  const outage = reportOutage(runsNewestFirst);
  if (!report) {
    return { available: false, ...(outage ? { note: outageSentence(outage) } : {}) };
  }

  const { writtenOn, ageDays } = reportAge(report.createdAt, now);
  if (!outage && ageDays < STALE_AFTER_DAYS) return { ...report, writtenOn, ageDays };

  const note = [
    `This report was written on ${spokenDay(writtenOn)}, ${ageDays} ${ageDays === 1 ? "day" : "days"} ago.`,
    ...(outage ? [outageSentence(outage)] : []),
    "Say how old it is before using it, and treat its figures as out of date.",
  ].join(" ");
  // The note first: Jarvis cuts a long result short, and the end is what goes.
  return { note, ...report, writtenOn, ageDays };
}
