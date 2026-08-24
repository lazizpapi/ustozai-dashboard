import "server-only";

import { get } from "./client";
import { parseActiveUsers, parseDailyViews, parseTransactions, parseVisitSummary } from "./parse";
import { step } from "@/lib/collectors/run-step";
import { saveActiveUsers, saveEngagement, saveRevenue } from "@/lib/db/persist";
import { ustozApiEnv } from "@/lib/env";
import type { RunOutcome } from "@/lib/db/persist";

/**
 * Pull UstozAI's own metrics.
 *
 * Every endpoint runs inside step(), so one dead route cannot take the others
 * down and each appears separately in collector health. That matters more
 * here than for the store collectors: six of these ten endpoints need a
 * bearer token, and until one exists they must show as a named, explicable
 * gap rather than as a general failure of the integration.
 *
 * The window is deliberately wider than a single day. These endpoints accept
 * a date range and restate recent days, so re-reading the last week each run
 * costs four requests and repairs any day a failed run left behind.
 *
 * With one exception, which is why ustozRanges below returns two windows
 * rather than one. See the note on the visit-summary step.
 */

const BACKFILL_DAYS = 7;

/**
 * A type alias rather than an interface on purpose: the client's params take a
 * Record, and only an alias gets the implicit index signature that satisfies it.
 */
export type UstozRange = {
  startDate: string;
  endDate: string;
};

/**
 * The two windows a run needs.
 *
 * `wide` is the backfill window, for the endpoints that return a value per day
 * and restate the ones they already gave. Re-reading a week repairs whatever a
 * failed run left behind, and asking for more repairs more.
 *
 * `daily` is always exactly one day, and exists because the visit summary does
 * not return a series. It answers for whatever window it is handed, as a single
 * number. Given the wide window it returns the average across all of it, which
 * then gets written to one date in a table called app_engagement_daily and read
 * as though it described that date. Widening the backfill made the headline
 * session figure less true rather than more complete, which is the opposite of
 * what a backfill is for.
 */
export function ustozRanges(
  today: string,
  earliest: string,
): { wide: UstozRange; daily: UstozRange } {
  return {
    wide: { startDate: earliest, endDate: today },
    daily: { startDate: today, endDate: today },
  };
}

/** Tashkent calendar day, the bucket every date in this project uses. */
function tashkentDay(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export interface UstozCollectResult {
  outcomes: RunOutcome[];
  activeUsers: number;
  engagementDays: number;
  revenueRows: number;
}

/**
 * @param days How far back to re-read. The default repairs a week; a larger
 *   value is used once to backfill history, since the API happily returns
 *   months of daily figures in a single call.
 */
export async function collectUstozMetrics(
  days = BACKFILL_DAYS,
): Promise<UstozCollectResult> {
  if (!ustozApiEnv()) {
    return {
      outcomes: [
        {
          source: "ustoz:api",
          status: "skipped",
          error: "USTOZ_API_BASE_URL is not set",
        },
      ],
      activeUsers: 0,
      engagementDays: 0,
      revenueRows: 0,
    };
  }

  const { wide: range, daily: dayRange } = ustozRanges(tashkentDay(), tashkentDay(-days));
  const { startDate, endDate } = range;

  const activeStep = await step("ustoz:active-users", async () => {
    const payload = await get("mauGeneral", range);
    return parseActiveUsers(payload, startDate, endDate);
  });

  const viewsStep = await step("ustoz:views", async () => {
    const payload = await get("dauDaily", range);
    return parseDailyViews(payload);
  });

  /*
   * Asked for one day, never for the range.
   *
   * Unlike the others this endpoint returns a single aggregate rather than a
   * per-day series, so whatever window it is given comes back as one number.
   * Handing it `range` meant the hourly poll wrote a seven-day average onto
   * today's row and a `backfill-ustoz?days=250` run wrote a two-hundred-and-
   * fifty-day one onto the same row, both stored in a table called
   * app_engagement_daily and displayed beside a figure that really is daily.
   * That is how the tile came to read 29.4 minutes.
   */
  const visitStep = await step("ustoz:visit-summary", async () => {
    const payload = await get("visitSummary", dayRange);
    return parseVisitSummary(payload);
  });

  const revenueStep = await step("ustoz:transactions", async () => {
    const payload = await get("transactionsByProvider", range);
    return parseTransactions(payload);
  });

  const outcomes = [activeStep, viewsStep, visitStep, revenueStep].map((result) => result.outcome);

  // Writes are separate steps so a parse that worked but a write that failed
  // is distinguishable from the endpoint being down.
  let activeUsers = 0;
  let engagementDays = 0;
  let revenueRows = 0;

  if (activeStep.value) {
    const write = await step("ustoz:active-users:write", () =>
      saveActiveUsers(activeStep.value!.dau, activeStep.value!.mau),
    );
    activeUsers = write.value ?? 0;
    outcomes.push(write.outcome);
  }

  /*
   * Views are per day and land on the days they describe. The visit summary is
   * a single figure, now asked for a single day, so attributing it to that day
   * is honest rather than the best available approximation.
   *
   * Historical rows still hold the trailing-window values written before this
   * changed. Rewriting them would cost one request per day, the same trade the
   * Instagram collector documents, and nobody is reading a session average from
   * March.
   */
  const engagementRows = [
    ...(viewsStep.value ?? []).map((point) => ({ date: point.date, views: point.count })),
    ...(visitStep.value
      ? [
          {
            date: endDate,
            totalLogins: visitStep.value.totalLogins,
            averageMinutes: visitStep.value.averageMinutes,
          },
        ]
      : []),
  ];

  if (engagementRows.length > 0) {
    const write = await step("ustoz:engagement:write", () => saveEngagement(engagementRows));
    engagementDays = write.value ?? 0;
    outcomes.push(write.outcome);
  }

  if (revenueStep.value && revenueStep.value.length > 0) {
    const write = await step("ustoz:revenue:write", () => saveRevenue(revenueStep.value!));
    revenueRows = write.value ?? 0;
    outcomes.push(write.outcome);
  }

  return { outcomes, activeUsers, engagementDays, revenueRows };
}
