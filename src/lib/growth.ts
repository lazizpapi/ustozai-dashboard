/**
 * Turning readings into "how much did we gain".
 *
 * Pure and separate from the database, because every hard part here is a
 * boundary condition that needs testing without waiting for a Tuesday.
 *
 * Two kinds of source feed this, and they need opposite arithmetic:
 *
 * Counters (followers, cumulative installs) only ever report a running total,
 * so the gain for a period is the difference between where the total ended and
 * where it ended the period before.
 *
 * Events (reviews, a day's downloads) already describe a single period each, so
 * the gain is a sum.
 *
 * Getting those two the wrong way round produces numbers that look plausible
 * and are wildly wrong, which is why they are separate functions rather than
 * one with a flag.
 */

import { TV_TIMEZONE } from "./tv-theme";

export type Period = "day" | "week" | "month" | "year";

export const PERIODS: readonly Period[] = ["day", "week", "month", "year"];

export const PERIOD_LABELS: Record<Period, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};

/** Narrow an untrusted query string without throwing on nonsense. */
export function toPeriod(raw: string | undefined): Period {
  return PERIODS.includes(raw as Period) ? (raw as Period) : "day";
}

/**
 * The calendar date in the office's own timezone, as YYYY-MM-DD.
 *
 * This matters more than it looks. Timestamps are stored in UTC, and Tashkent
 * runs five hours ahead, so anything logged after 19:00 UTC already belongs to
 * the next day locally. Bucketing on the raw UTC date would file a Tuesday
 * evening's joins under Monday and quietly make every "today" figure wrong for
 * the people reading it.
 *
 * en-CA because it formats as YYYY-MM-DD, which sorts correctly as a string.
 */
export function localDate(iso: string, timeZone = TV_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/**
 * The bucket a local date falls in, named by the date the bucket starts.
 *
 * Weeks start Monday, which is both the ISO convention and the working week
 * here. Using the start date as the key means buckets sort chronologically as
 * plain strings, so nothing downstream needs to parse them back.
 */
export function bucketOf(localDay: string, period: Period): string {
  if (period === "day") return localDay;
  if (period === "month") return `${localDay.slice(0, 7)}-01`;
  if (period === "year") return `${localDay.slice(0, 4)}-01-01`;

  // Anchored at midday UTC so that adding or subtracting whole days can never
  // trip over a daylight-saving edge in some other zone.
  const date = new Date(`${localDay}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // Monday becomes 0.
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

/** The bucket the clock is in right now, which is by definition incomplete. */
export function currentBucket(period: Period, now: Date = new Date()): string {
  return bucketOf(localDate(now.toISOString()), period);
}

export interface Reading {
  /** ISO timestamp of the reading. */
  at: string;
  /** The running total at that moment. */
  value: number;
}

export interface GrowthPoint {
  /** Bucket start date, YYYY-MM-DD. */
  bucket: string;
  /** Net change across the bucket. Negative is real and must be preserved. */
  value: number;
  /** True for a bucket still in progress, which is always understated. */
  isPartial: boolean;
}

/**
 * Net change per period, from a running total.
 *
 * Takes the *last* reading in each bucket, not the first, and differences
 * consecutive buckets. Last rather than first is what makes a missed poll
 * harmless: the gain it would have recorded is not lost, it simply lands in
 * whichever bucket the next successful reading closes.
 *
 * The earliest bucket is dropped. With nothing before it there is nothing to
 * difference against, and rendering the running total itself as if it were a
 * gain would put a bar of fifty thousand next to bars of thirty.
 */
export function netChangeByBucket(
  readings: Reading[],
  period: Period,
  now: Date = new Date(),
): GrowthPoint[] {
  const lastPerBucket = new Map<string, { at: string; value: number }>();

  for (const reading of readings) {
    const bucket = bucketOf(localDate(reading.at), period);
    const held = lastPerBucket.get(bucket);
    if (!held || reading.at > held.at) lastPerBucket.set(bucket, reading);
  }

  const buckets = [...lastPerBucket.keys()].sort();
  const open = currentBucket(period, now);

  return buckets.slice(1).map((bucket, index) => ({
    bucket,
    value: lastPerBucket.get(bucket)!.value - lastPerBucket.get(buckets[index])!.value,
    isPartial: bucket >= open,
  }));
}

/**
 * Count per period, from things that each happened once.
 *
 * Zero-fills the gaps. A week with no reviews is a fact worth drawing; leaving
 * it out would close the gap and make a quiet stretch look like a busy one.
 */
export function countByBucket(
  timestamps: string[],
  period: Period,
  now: Date = new Date(),
): GrowthPoint[] {
  return sumByBucket(
    timestamps.map((at) => ({ at, amount: 1 })),
    period,
    now,
  );
}

/** As countByBucket, but each event carries a quantity. Used for daily units. */
export function sumByBucket(
  events: { at: string; amount: number }[],
  period: Period,
  now: Date = new Date(),
): GrowthPoint[] {
  const totals = new Map<string, number>();

  for (const event of events) {
    const bucket = bucketOf(localDate(event.at), period);
    totals.set(bucket, (totals.get(bucket) ?? 0) + event.amount);
  }
  if (totals.size === 0) return [];

  const open = currentBucket(period, now);
  const sorted = [...totals.keys()].sort();

  return fillBuckets(sorted[0], sorted[sorted.length - 1], period).map((bucket) => ({
    bucket,
    value: totals.get(bucket) ?? 0,
    isPartial: bucket >= open,
  }));
}

/** Every bucket start from first to last inclusive, so gaps render as zero. */
export function fillBuckets(first: string, last: string, period: Period): string[] {
  const out: string[] = [];
  const step = { day: 1, week: 7, month: 0, year: 0 }[period];

  if (step > 0) {
    for (let d = new Date(`${first}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + step)) {
      const key = d.toISOString().slice(0, 10);
      if (key > last) break;
      out.push(key);
      // Guard against a malformed range spinning forever.
      if (out.length > 800) break;
    }
    return out;
  }

  const startYear = Number.parseInt(first.slice(0, 4), 10);
  const endYear = Number.parseInt(last.slice(0, 4), 10);

  if (period === "year") {
    for (let y = startYear; y <= endYear; y += 1) out.push(`${y}-01-01`);
    return out;
  }

  let year = startYear;
  let month = Number.parseInt(first.slice(5, 7), 10);
  while (`${year}-${String(month).padStart(2, "0")}-01` <= last) {
    out.push(`${year}-${String(month).padStart(2, "0")}-01`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}
