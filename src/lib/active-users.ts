import { z } from "zod";

/**
 * Active-user counts pushed from the UstozAI app's own backend.
 *
 * Every other figure on this dashboard is one we collect ourselves from a
 * store or a social platform. This is the first that arrives from somebody
 * else's cron job, which makes it the first that a bug on their side can
 * quietly corrupt: nothing here would throw, the numbers would simply be
 * wrong, and a wrong DAU is the single most quotable number in the company.
 *
 * So the boundary is strict rather than forgiving. A malformed push is
 * rejected with a message naming what was wrong, instead of being coerced
 * into something storable. In particular nothing is defaulted to zero: a
 * missing field means the sender is broken, and zero is a claim that nobody
 * opened the app.
 */

/** Platforms a count can describe. "all" is the combined figure. */
export const ACTIVE_USER_PLATFORMS = ["all", "ios", "android", "web"] as const;

export type ActiveUserPlatform = (typeof ACTIVE_USER_PLATFORMS)[number];

export interface ActiveUsersRow {
  date: string;
  platform: ActiveUserPlatform;
  dau: number;
  wau: number;
  mau: number;
}

/**
 * A whole, non-negative count.
 *
 * Rejects strings deliberately. A body carrying "1200" rather than 1200 was
 * usually assembled by string concatenation, and the field after it is
 * likely wrong too, so it is worth failing loudly on the first one.
 */
const count = z.int().min(0);

/**
 * A calendar date, exactly as YYYY-MM-DD, that really exists.
 *
 * The regex alone would accept 2026-02-31; the round-trip catches that. Loose
 * parsing is worse than rejection here, because a figure filed under the
 * wrong day is invisible once stored.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be formatted YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "date is not a real calendar date");

const rowSchema = z.object({
  date: isoDate,
  platform: z.enum(ACTIVE_USER_PLATFORMS).default("all"),
  dau: count,
  wau: count,
  mau: count,
});

export type ParseResult =
  | { ok: true; rows: ActiveUsersRow[] }
  | { ok: false; error: string };

/**
 * Tomorrow in Tashkent, as the latest date a push may claim.
 *
 * Compared against the local day rather than UTC because the sender is in
 * Tashkent: at 02:00 local it is still yesterday in UTC, and a correct push
 * for "today" would otherwise be rejected as being from the future.
 */
function tooFarAhead(date: string, now: Date): boolean {
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return date > localToday;
}

/**
 * Validate a push body into rows ready to upsert.
 *
 * Accepts a single day or an array of them, so the backend can backfill its
 * history in one request rather than one call per day.
 */
export function parseActiveUsersPayload(body: unknown, now: Date = new Date()): ParseResult {
  const items = Array.isArray(body) ? body : [body];

  if (items.length === 0) {
    return { ok: false, error: "no rows: an empty array is a sender bug, not a no-op" };
  }

  const rows: ActiveUsersRow[] = [];

  for (const item of items) {
    const parsed = rowSchema.safeParse(item);
    if (!parsed.success) {
      // The date, when we can see one, so a rejected backfill of thirty days
      // says which day to look at rather than sending them hunting.
      const label =
        item && typeof item === "object" && "date" in item
          ? ` for ${String((item as { date: unknown }).date)}`
          : "";
      const issue = parsed.error.issues[0];
      const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return { ok: false, error: `invalid row${label}: ${where}${issue.message}` };
    }

    const row = parsed.data;

    // Someone active today is by definition active this week and this month.
    // Violating that is always a bug on the sender's side, and storing it
    // would put an impossible stickiness ratio on the dashboard.
    if (row.dau > row.wau) {
      return {
        ok: false,
        error: `invalid row for ${row.date}: dau (${row.dau}) cannot exceed wau (${row.wau})`,
      };
    }
    if (row.wau > row.mau) {
      return {
        ok: false,
        error: `invalid row for ${row.date}: wau (${row.wau}) cannot exceed mau (${row.mau})`,
      };
    }

    if (tooFarAhead(row.date, now)) {
      return {
        ok: false,
        error: `invalid row for ${row.date}: the date is in the future, which usually means a timezone bug in the sender`,
      };
    }

    rows.push(row);
  }

  return { ok: true, rows };
}

/**
 * DAU as a percentage of MAU: the share of monthly users who came back today.
 *
 * Null rather than zero without a denominator. "0%" says nobody returns,
 * which is a claim about the product; no MAU is the absence of a claim.
 */
export function stickiness(dau: number | null, mau: number | null): number | null {
  if (dau === null || mau === null || !Number.isFinite(dau) || !Number.isFinite(mau)) {
    return null;
  }
  if (mau <= 0) return null;
  return (dau / mau) * 100;
}
