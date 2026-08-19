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
 */

const BACKFILL_DAYS = 7;

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

  const startDate = tashkentDay(-days);
  const endDate = tashkentDay();
  const range = { startDate, endDate };

  const activeStep = await step("ustoz:active-users", async () => {
    const payload = await get("mauGeneral", range);
    return parseActiveUsers(payload, startDate, endDate);
  });

  const viewsStep = await step("ustoz:views", async () => {
    const payload = await get("dauDaily", range);
    return parseDailyViews(payload);
  });

  const visitStep = await step("ustoz:visit-summary", async () => {
    const payload = await get("visitSummary", range);
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
   * Views are per day; the visit summary covers the whole range at once and
   * is therefore attributed to the last day of it rather than spread across
   * days it cannot distinguish.
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
