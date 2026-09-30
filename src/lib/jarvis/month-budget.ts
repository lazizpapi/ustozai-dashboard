import "server-only";

import { jarvisCallSecondsSince } from "@/lib/db/queries";

import { type MonthUsage, billedMinutes, monthStart, monthUsage } from "./budget";

/**
 * This month's agent minutes from the call log, or null when they cannot be
 * counted. A failed count never stops a call: LiveKit's own cap still holds.
 */
export async function readMonthUsage(now: Date = new Date()): Promise<MonthUsage | null> {
  try {
    return monthUsage(billedMinutes(await jarvisCallSecondsSince(monthStart(now))));
  } catch (error) {
    console.warn("jarvis: could not count this month's minutes", error);
    return null;
  }
}
