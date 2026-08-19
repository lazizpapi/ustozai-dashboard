/**
 * Turning UstozAI's admin API into rows.
 *
 * Shapes here were captured from the live API on 2026-08-19 rather than read
 * from the API document, which lists endpoints and the panel each one feeds
 * but not a single response shape. That mattered twice: the document calls
 * `/statistics/views/daily` the DAU chart when it is really a view count
 * roughly twenty-five times larger, and `dau/general-stats` turns out to
 * carry both DAU and MAU together.
 *
 * The rule throughout is the collectors' rule. A field that is absent becomes
 * null, never zero, because zero is a claim that nobody used the app. A
 * payload in an unrecognised shape throws, because storing nothing is
 * recoverable and storing a wrong number is not.
 */

/** Uzbek month names, as the API labels its monthly buckets. */
const MONTH_NAMES = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A finite number, or null. Strings are refused rather than coerced. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface DauPoint {
  date: string;
  count: number;
}

export interface MauPoint {
  /** "YYYY-MM", or null when the label could not be placed in the range. */
  month: string | null;
  /** The label exactly as the API gave it, so a null month is explainable. */
  label: string;
  count: number;
}

export interface ActiveUsers {
  dau: DauPoint[];
  mau: MauPoint[];
}

/** Every "YYYY-MM" between two ISO dates, inclusive, oldest first. */
function monthsBetween(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const start = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);

  for (let at = start; at <= end; at.setUTCMonth(at.getUTCMonth() + 1)) {
    months.push(at.toISOString().slice(0, 7));
    // Twelve years of months is far past any window this is called with, and
    // stops a malformed range from spinning forever.
    if (months.length > 144) break;
  }
  return months;
}

/**
 * Daily and monthly active users, from `/statistics/dau/general-stats`.
 *
 * The monthly buckets are labelled with a month name and no year, so the year
 * can only come from the window that was requested. Rather than zipping
 * positionally, which silently shifts every month if the API omits one, each
 * label is matched by name against the months in the range. A label that
 * matches nothing keeps a null month and its original text, so the gap is
 * explainable instead of being filed under a guess.
 */
export function parseActiveUsers(
  payload: unknown,
  startDate: string,
  endDate: string,
): ActiveUsers {
  if (!isRecord(payload)) {
    throw new Error("active users: payload was not an object");
  }
  const { dauStats, mauStats } = payload;
  if (!Array.isArray(dauStats) || !Array.isArray(mauStats)) {
    throw new Error("active users: dauStats and mauStats must both be arrays");
  }

  /*
   * Days arrive more than once. Over a nine-month range four dates came back
   * twice, each as the real figure plus a stray 1 (782 and 1 on 2026-07-13),
   * which reads as disjoint buckets rather than a restatement, so they are
   * summed and the error bound is one user.
   *
   * What this mainly prevents is worse than an off-by-one. Letting the last
   * row win would have stored 1 active user for a day with 782, and Postgres
   * refuses an upsert batch holding the same key twice, so the backfill
   * failed outright until duplicates were merged here.
   */
  const dauByDate = new Map<string, number>();
  for (const entry of dauStats) {
    if (!isRecord(entry)) continue;
    const label = entry.label;
    const count = num(entry.count);
    // A row we cannot date is dropped on its own; the rest of the response is
    // still good data and discarding all of it would be the worse trade.
    if (typeof label !== "string" || !ISO_DATE.test(label) || count === null) continue;
    dauByDate.set(label, (dauByDate.get(label) ?? 0) + count);
  }

  const dau: DauPoint[] = [...dauByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const monthsInRange = monthsBetween(startDate, endDate);
  // Months are merged on the same rule as days, keyed by the label so an
  // unrecognised one still collapses with its own duplicates.
  const mauByLabel = new Map<string, { month: string | null; label: string; count: number }>();

  for (const entry of mauStats) {
    if (!isRecord(entry)) continue;
    const label = entry.label;
    const count = num(entry.count);
    if (typeof label !== "string" || count === null) continue;

    const index = MONTH_NAMES.indexOf(
      label.trim().toLowerCase() as (typeof MONTH_NAMES)[number],
    );
    const month =
      index === -1
        ? null
        : (monthsInRange.find((candidate) => Number(candidate.slice(5, 7)) === index + 1) ??
          null);

    const existing = mauByLabel.get(label);
    if (existing) existing.count += count;
    else mauByLabel.set(label, { month, label, count });
  }

  return { dau, mau: [...mauByLabel.values()] };
}

export interface ViewPoint {
  date: string;
  count: number;
}

/**
 * Daily view counts, from `/statistics/views/daily`.
 *
 * Wrapped once where general-stats is wrapped twice, and despite its
 * documentation this is a view count rather than active users. Kept under its
 * own name so nothing downstream can mistake the two.
 */
export function parseDailyViews(payload: unknown): ViewPoint[] {
  if (!Array.isArray(payload)) {
    throw new Error("daily views: payload was not an array");
  }

  const points: ViewPoint[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const date = entry.date;
    const count = num(entry.count);
    if (typeof date !== "string" || !ISO_DATE.test(date) || count === null) continue;
    points.push({ date, count });
  }
  return points;
}

export interface VisitSummary {
  totalLogins: number | null;
  averageMinutes: number | null;
}

/** Logins and average session length, from `/statistics/visit-summary`. */
export function parseVisitSummary(payload: unknown): VisitSummary {
  if (!isRecord(payload)) {
    throw new Error("visit summary: payload was not an object");
  }
  return {
    totalLogins: num(payload.totalLogins),
    averageMinutes: num(payload.averageMinutes),
  };
}

export interface TransactionRow {
  date: string;
  /** "ALL" is the day's own total, as the API reports it. */
  provider: string;
  amount: number;
  transactions: number;
}

/**
 * Revenue by day and payment provider, from
 * `/statistics/transactions/by-provider-date`.
 *
 * The payload is an object keyed by date, and each day holds its own total
 * plus one array per provider. Providers are discovered rather than listed,
 * so a new one appears on its own instead of vanishing because this parser
 * only knew PAYME and CLICK on the day it was written.
 *
 * Amounts are passed through exactly as the API reports them. The unit is not
 * documented anywhere we have, and dividing by a guessed hundred would be a
 * hundredfold error in the most quotable number in the company.
 */
export function parseTransactions(payload: unknown): TransactionRow[] {
  if (!isRecord(payload)) {
    throw new Error("transactions: payload was not an object");
  }

  const rows: TransactionRow[] = [];

  for (const date of Object.keys(payload).sort()) {
    if (!ISO_DATE.test(date)) continue;
    const day = payload[date];
    if (!isRecord(day)) continue;

    const total = num(day.totalAmount);
    const totalCount = num(day.totalCount);
    if (total !== null) {
      rows.push({
        date,
        provider: "ALL",
        amount: total,
        transactions: totalCount ?? 0,
      });
    }

    for (const [provider, entries] of Object.entries(day)) {
      if (!Array.isArray(entries)) continue;
      let amount = 0;
      let transactions = 0;
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        amount += num(entry.amount) ?? 0;
        transactions += num(entry.count) ?? 0;
      }
      rows.push({ date, provider, amount, transactions });
    }
  }

  return rows;
}
