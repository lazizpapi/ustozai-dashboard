/**
 * The agent minutes Jarvis has left this month.
 *
 * LiveKit Cloud's free plan gives the agent 1,000 minutes a month, and the
 * allowance is a hard cap: once it is spent, every call fails until the 1st,
 * and the caller sees only "could not connect". The call log knows how long
 * every call lasted, so the dashboard counts from it, warns while there is
 * still time, and refuses a call with a sentence that says why.
 *
 * The count is an estimate of LiveKit's own: each call is rounded up to whole
 * minutes, which errs on the side of stopping early.
 */

export const FREE_MINUTES = 1000;
/** Below this many minutes left, the call screen and the Calls page say so. */
export const LOW_MINUTES = 200;

export type MonthUsage = { used: number; left: number; low: boolean; spent: boolean };

export function billedMinutes(durationsSeconds: readonly number[]): number {
  return durationsSeconds.reduce((sum, seconds) => sum + Math.ceil(Math.max(0, seconds) / 60), 0);
}

export function monthUsage(used: number, cap: number = FREE_MINUTES): MonthUsage {
  const left = Math.max(0, cap - used);
  return { used, left, low: left <= LOW_MINUTES, spent: left === 0 };
}

/** The 1st of this month at midnight UTC, when LiveKit resets its allowances. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The line under the call button when minutes run low, or null. */
export function budgetNotice(usage: MonthUsage): string | null {
  if (usage.spent) return "This month's free minutes are used up. They come back on the 1st.";
  if (usage.low) return `About ${usage.left} minutes of calls left this month.`;
  return null;
}
