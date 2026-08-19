/**
 * Display formatting.
 *
 * Pure and unit tested, because the rules here are where a dashboard most
 * easily lies. Two in particular:
 *
 * A rank improves as its number falls, so the direction of a rank delta is the
 * opposite of every other metric on the page.
 *
 * "No comparison available" and "no change" are different facts. They render
 * differently and are never collapsed into a 0.
 */

/**
 * What a figure shows when there is nothing to show.
 *
 * Two hyphens rather than an em dash. The em dash is the single most reliable
 * tell of machine-written interface copy, and in Geist Mono a double hyphen
 * also reads as deliberately terminal rather than as a typographic flourish.
 * Every "no reading" in the app resolves here, so the character is decided in
 * one place instead of being retyped into thirty components.
 */
export const NO_VALUE = "--";

export type Direction = "up" | "down" | "flat" | "unknown";

export interface Delta {
  direction: Direction;
  magnitude: number | null;
  /** Ready-to-render label, already correct for the metric's polarity. */
  label: string;
  /**
   * How far back the comparison actually reached, when that is not the week
   * the pages already claim in their headings. Null means "a week, as stated"
   * or "nothing to compare", so a caller can render it unconditionally.
   */
  spanLabel: string | null;
}

/** The full week every page already announces, so it needs no restating. */
const STATED_SPAN_DAYS = 7;

/**
 * Names a comparison span, when it differs from the week the pages claim.
 *
 * This exists because both alternatives were worse. Comparing against
 * whatever reading happens to be oldest and still calling it a week is a lie.
 * Refusing to compare until the seventh day left every movement column on the
 * market page showing dashes while real movement was happening. "over 4 days"
 * is the only version that is both useful and true.
 */
function spanLabel(spanDays: number | null | undefined): string | null {
  if (spanDays === null || spanDays === undefined) return null;
  if (!Number.isFinite(spanDays) || spanDays < 1) return null;
  if (spanDays === STATED_SPAN_DAYS) return null;
  return `over ${spanDays} ${spanDays === 1 ? "day" : "days"}`;
}

const NBSP = " ";

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value.toLocaleString("en-US");
}

export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return value.toFixed(2);
}

export function formatRank(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE;
  return `#${value}`;
}

/**
 * A growth bucket's axis label, at the resolution that period deserves.
 *
 * A year of daily bars cannot show a day number on every tick, and a yearly
 * chart showing "1 Jan 2025" says nothing "2025" does not. Each period gets the
 * shortest label that still identifies the bucket.
 */
export function formatBucket(bucket: string | null | undefined, period: string): string {
  if (!bucket) return NO_VALUE;
  if (period === "year") return bucket.slice(0, 4);

  const date = new Date(`${bucket}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return NO_VALUE;

  if (period === "month") {
    return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  // Days and weeks both name the day the bucket starts.
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Signed, so a net loss reads as one at a glance rather than as a smaller gain. */
export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}

/** Spelled out, because a bare code beside a store name reads as a country. */
const LANGUAGE_NAMES: Record<string, string> = {
  uz: "Uzbek",
  ru: "Russian",
  en: "English",
};

/**
 * Where a review came from, said in a way that cannot be misread.
 *
 * reviews.country means two different things depending on the store: the
 * storefront for the App Store, and the language the review was written in for
 * Google Play, which publishes no reviewer country at all. Printing the raw
 * code for both would label a Russian-language review from Tashkent as "RU"
 * and quietly turn a language into a location.
 */
export function reviewSource(platform: string, country: string): string {
  if (platform !== "android") return `App Store ${country.toUpperCase()}`;

  const code = country.toLowerCase();
  return `Google Play, ${LANGUAGE_NAMES[code] ?? code}`;
}

/**
 * A conversion rate, as a share of a total.
 *
 * Returns the no-value placeholder rather than 0% when the denominator is zero. A funnel
 * stage with nothing above it has no rate at all, and printing "0.0%" would
 * read as "nobody converted" when the truth is "nothing arrived yet".
 *
 * One decimal place, because these figures sit in the low single digits where
 * a whole number loses real movement, and two would imply a precision that
 * daily analytics restatements do not support.
 */
export function formatPercent(part: number | null, whole: number | null): string {
  if (part === null || whole === null || !Number.isFinite(part) || !Number.isFinite(whole)) {
    return NO_VALUE;
  }
  if (whole <= 0) return NO_VALUE;
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Delta for a metric where a bigger number is better: rating, installs, reviews.
 */
export function delta(
  current: number | null,
  previous: number | null,
  spanDays?: number | null,
): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet", spanLabel: null };
  }
  const span = spanLabel(spanDays);
  const change = current - previous;
  if (change === 0) {
    return { direction: "flat", magnitude: 0, label: "no change", spanLabel: span };
  }
  return {
    direction: change > 0 ? "up" : "down",
    magnitude: Math.abs(change),
    label: `${change > 0 ? "+" : "-"}${formatNumber(Math.abs(change))}`,
    spanLabel: span,
  };
}

/**
 * Delta for a rank, where falling from #24 to #21 is an improvement.
 *
 * The returned direction is the direction of the *app's fortunes*, not of the
 * integer, so callers can point an arrow at it without re-deriving polarity.
 */
export function rankDelta(
  current: number | null,
  previous: number | null,
  spanDays?: number | null,
): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet", spanLabel: null };
  }
  const span = spanLabel(spanDays);
  const improvement = previous - current;
  if (improvement === 0) {
    return { direction: "flat", magnitude: 0, label: "no change", spanLabel: span };
  }
  return {
    direction: improvement > 0 ? "up" : "down",
    magnitude: Math.abs(improvement),
    label: `${improvement > 0 ? "up" : "down"}${NBSP}${Math.abs(improvement)}`,
    spanLabel: span,
  };
}

export function formatRatingDelta(
  current: number | null,
  previous: number | null,
  spanDays?: number | null,
): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet", spanLabel: null };
  }
  const span = spanLabel(spanDays);
  const change = current - previous;
  if (Math.abs(change) < 0.005) {
    return { direction: "flat", magnitude: 0, label: "no change", spanLabel: span };
  }
  return {
    direction: change > 0 ? "up" : "down",
    magnitude: Math.abs(change),
    label: `${change > 0 ? "+" : "-"}${Math.abs(change).toFixed(2)}`,
    spanLabel: span,
  };
}

/** Compact relative age for freshness badges. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const elapsed = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsed)) return "never";
  if (elapsed < 0) return "just now";

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Renders a date as the day it describes, never as a moment.
 *
 * Days are Tashkent days, matching every bucket in this system: the
 * collectors file readings by Tashkent date, so a label that named the UTC
 * day would disagree with the bucket it sits above. Concretely, a 20:00 UTC
 * reading belongs to the next Tashkent morning, and labelling it as the
 * previous day put chart ticks behind their own data and made two different
 * days print the same date.
 *
 * Bare YYYY-MM-DD strings are already Tashkent dates, so they are anchored at
 * midnight UTC and land on the same date once shifted: Tashkent is UTC+5 with
 * no daylight saving, so the day can never roll backwards.
 */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return NO_VALUE;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Tashkent",
  });
}

/**
 * Names the apostrophe in a keyword, when it is not the plain ASCII one.
 *
 * The tracked keyword list holds ta'lim twice on purpose: Uzbek Latin uses
 * U+02BC for the glottal stop, almost nobody types it on a phone, and Apple
 * returns different results for the two strings. Rendered plainly the two rows
 * are visually identical, so the page looks like it is repeating itself. This
 * is what tells them apart.
 *
 * Returns null for ASCII or apostrophe-free keywords, so the common case adds
 * nothing to the page.
 */
export function apostropheNote(keyword: string): string | null {
  if (keyword.includes("ʼ")) return "modifier ʼ";
  if (keyword.includes("ʻ")) return "turned comma ʻ";
  if (keyword.includes("’")) return "curly ’";
  return null;
}
