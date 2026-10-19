import type { Role } from "@/lib/roles";

import { DEPARTMENT_NAMES } from "./authority";
import { tashkentDate } from "./context";

/**
 * Reminders posted to the team's Telegram group on the day they fall due.
 *
 * A reminder used to be heard only when its department next called Jarvis,
 * which could be days later or never. Now the hourly poll's 9:00 run (Tashkent)
 * posts each department's due reminders to the team group, one Uzbek message
 * per department with a "Bajarildi" button under each reminder; a tap clears
 * it (src/app/api/webhook/telegram/route.ts). Decided with Lazizbek on
 * 19 October 2026:
 *
 * - The CEO's reminders are never posted: they can be personal, and the group
 *   is everyone's. They are still said at the start of the CEO's calls.
 * - One nobody clears is posted on three mornings at most, then left to the
 *   notes page and the calls, so it nudges without becoming noise.
 * - Each reminder is claimed for the day before its message is sent, so a
 *   rerun of the poll, or two at once, never posts it twice.
 */

export const MAX_POSTS = 3;
export const POSTING_HOUR = 9;

/** Telegram refuses a whole message above this many characters. */
export const TELEGRAM_LIMIT = 4096;
/**
 * A message's share of reminders: well under the limit and ten at most, so
 * even with every one ticked off by someone with a long name, the redrawn
 * message still fits.
 */
const BATCH_CHARS = 2700;
const MAX_PER_MESSAGE = 10;
/** A ticked-off reminder is shown shortened; it is done, and the space is needed. */
const CLEARED_TEXT_CHARS = 80;

/** One reminder as the posting code reads it (migration 0023). */
export type ReminderRow = {
  id: string;
  role: Role;
  text: string;
  due_on: string | null;
  created_at: string;
  post_count: number;
  last_posted_on: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
};

export type InlineButton = { text: string; callback_data: string };
export type InlineKeyboard = InlineButton[][];

/** Departments in the order their messages always go out. */
const POSTED_ROLES: readonly Role[] = ["marketing", "product", "it"];

const TASHKENT_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tashkent",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Whether this is the poll that posts: the one between 9:00 and 10:00 in Tashkent. */
export function isPostingHour(now: Date): boolean {
  return Number(TASHKENT_HOUR.format(now)) === POSTING_HOUR;
}

/** What goes out this morning: open, due, not the CEO's, not yet posted today, not posted three times. */
export function remindersToPost(rows: readonly ReminderRow[], today: string): Map<Role, ReminderRow[]> {
  const due = rows
    .filter(
      (row) =>
        row.due_on !== null &&
        row.due_on <= today &&
        row.cleared_at === null &&
        POSTED_ROLES.includes(row.role) &&
        row.post_count < MAX_POSTS &&
        (row.last_posted_on === null || row.last_posted_on < today),
    )
    .sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? "") || a.created_at.localeCompare(b.created_at));

  const byRole = new Map<Role, ReminderRow[]>();
  for (const role of POSTED_ROLES) {
    const mine = due.filter((row) => row.role === role);
    if (mine.length > 0) byRole.set(role, mine);
  }
  return byRole;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One department's message, in Uzbek, each reminder's own text kept as saved.
 * Drawn the same way when first posted and after every tap: a ticked-off
 * reminder is struck through with who did it and keeps its button, so the
 * message's buttons always say which reminders it holds.
 */
export function reminderMessage(
  role: Role,
  rows: readonly ReminderRow[],
): { text: string; keyboard: InlineKeyboard } {
  const lines = rows.map((row, index) => {
    const number = `${index + 1}.`;
    if (row.cleared_at !== null) {
      const by = row.cleared_by ? ` <i>(${escape(row.cleared_by)})</i>` : "";
      const text = row.text.length > CLEARED_TEXT_CHARS ? `${row.text.slice(0, CLEARED_TEXT_CHARS)}…` : row.text;
      return `${number} ✓ <s>${escape(text)}</s>${by}`;
    }
    const again = row.post_count > 1 ? " <i>(qayta)</i>" : "";
    return `${number} ${escape(row.text)}${again}`;
  });
  const allDone = rows.length > 0 && rows.every((row) => row.cleared_at !== null);

  const text = [
    `⏰ <b>${DEPARTMENT_NAMES[role]} uchun bugungi eslatmalar</b>`,
    "",
    ...lines,
    ...(allDone ? ["", "Hammasi bajarildi ✓"] : []),
  ].join("\n");

  const keyboard = rows.map((row, index) => [
    {
      text: row.cleared_at === null ? `Bajarildi ✓ ${index + 1}` : `✓ ${index + 1}`,
      callback_data: `done:${row.id}`,
    },
  ]);
  return { text, keyboard };
}

/**
 * A department's reminders in the messages they go out in: a long list would
 * pass Telegram's limit and be refused whole, every morning.
 */
export function reminderBatches(rows: readonly ReminderRow[]): ReminderRow[][] {
  const batches: ReminderRow[][] = [];
  let batch: ReminderRow[] = [];
  let chars = 0;
  for (const row of rows) {
    const size = escape(row.text).length + 20;
    if (batch.length > 0 && (batch.length === MAX_PER_MESSAGE || chars + size > BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(row);
    chars += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

const DONE = /^done:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The reminder a tapped button stands for, or null for anything else. */
export function doneNoteId(data: unknown): string | null {
  if (typeof data !== "string") return null;
  return DONE.exec(data)?.[1] ?? null;
}

export type PostDeps = {
  now: Date;
  /** Open reminders due on or before this Tashkent day. */
  due: (today: string) => Promise<ReminderRow[]>;
  /** Marks one posted today; false when another run already did. */
  claim: (row: ReminderRow, today: string) => Promise<boolean>;
  /** Undoes a claim whose message did not go out. */
  unclaim: (row: ReminderRow) => Promise<void>;
  send: (text: string, keyboard: InlineKeyboard) => Promise<{ sent: boolean; reason?: string }>;
};

export type PostResult = { posted: number; skipped?: string; failed?: string[] };

/** The 9:00 run: claim, then post one message per department. */
export async function postDueReminders(deps: PostDeps): Promise<PostResult> {
  if (!isPostingHour(deps.now)) return { posted: 0, skipped: "not the 9:00 poll" };

  const today = tashkentDate(deps.now);
  const failed: string[] = [];
  let posted = 0;

  for (const [role, rows] of remindersToPost(await deps.due(today), today)) {
    for (const batch of reminderBatches(rows)) {
      // The rows as read, for giving a claim back.
      const claimed: ReminderRow[] = [];
      try {
        for (const row of batch) if (await deps.claim(row, today)) claimed.push(row);
        if (claimed.length === 0) continue;

        const shown = claimed.map((row) => ({ ...row, post_count: row.post_count + 1, last_posted_on: today }));
        const { text, keyboard } = reminderMessage(role, shown);
        const result = await deps.send(text, keyboard);
        if (result.sent) {
          posted += claimed.length;
          continue;
        }
        failed.push(`${role}: ${result.reason ?? "not sent"}`);
      } catch (error) {
        // A failure here must not cost the next department its morning.
        failed.push(`${role}: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Given back, so each reminder is still owed a morning rather than lost.
      for (const row of claimed) await deps.unclaim(row).catch(() => undefined);
    }
  }

  return { posted, failed };
}
