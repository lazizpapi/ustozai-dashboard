import type { JarvisNote } from "./notes";

/**
 * What Jarvis should know about a department as a call begins.
 *
 * Built from the call log and the department's notes, never from anything the
 * model wrote on its own: the last few calls (what was asked and Jarvis's last
 * answer), whether this is the department's first call today (Jarvis then
 * offers the morning briefing), and the reminders that have come due.
 *
 * "Today" is Tashkent's calendar day, the same day a reminder is due on.
 */

export const RECENT_CALLS = 3;

export type PastCall = { started_at: string; summary: string };

export type CallContext = {
  today: string;
  firstCallToday: boolean;
  recentCalls: PastCall[];
  dueReminders: JarvisNote[];
};

const TASHKENT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in Tashkent. */
export function tashkentDate(moment: Date): string {
  return TASHKENT_DAY.format(moment);
}

export function callContext(input: {
  now: Date;
  calls: readonly PastCall[];
  notes: readonly JarvisNote[];
}): CallContext {
  const today = tashkentDate(input.now);
  const newestFirst = [...input.calls].sort((a, b) => b.started_at.localeCompare(a.started_at));
  const dueReminders = input.notes
    .filter((note) => note.due_on !== null && note.due_on <= today)
    .sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));

  return {
    today,
    firstCallToday: !newestFirst.some((call) => tashkentDate(new Date(call.started_at)) === today),
    recentCalls: newestFirst.filter((call) => call.summary.trim() !== "").slice(0, RECENT_CALLS),
    dueReminders,
  };
}
