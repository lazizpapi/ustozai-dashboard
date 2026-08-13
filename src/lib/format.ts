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

export type Direction = "up" | "down" | "flat" | "unknown";

export interface Delta {
  direction: Direction;
  magnitude: number | null;
  /** Ready-to-render label, already correct for the metric's polarity. */
  label: string;
}

const NBSP = " ";

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function formatRank(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `#${value}`;
}

/**
 * Delta for a metric where a bigger number is better: rating, installs, reviews.
 */
export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet" };
  }
  const change = current - previous;
  if (change === 0) return { direction: "flat", magnitude: 0, label: "no change" };
  return {
    direction: change > 0 ? "up" : "down",
    magnitude: Math.abs(change),
    label: `${change > 0 ? "+" : "-"}${formatNumber(Math.abs(change))}`,
  };
}

/**
 * Delta for a rank, where falling from #24 to #21 is an improvement.
 *
 * The returned direction is the direction of the *app's fortunes*, not of the
 * integer, so callers can point an arrow at it without re-deriving polarity.
 */
export function rankDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet" };
  }
  const improvement = previous - current;
  if (improvement === 0) return { direction: "flat", magnitude: 0, label: "no change" };
  return {
    direction: improvement > 0 ? "up" : "down",
    magnitude: Math.abs(improvement),
    label: `${improvement > 0 ? "up" : "down"}${NBSP}${Math.abs(improvement)}`,
  };
}

export function formatRatingDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) {
    return { direction: "unknown", magnitude: null, label: "no history yet" };
  }
  const change = current - previous;
  if (Math.abs(change) < 0.005) {
    return { direction: "flat", magnitude: 0, label: "no change" };
  }
  return {
    direction: change > 0 ? "up" : "down",
    magnitude: Math.abs(change),
    label: `${change > 0 ? "+" : "-"}${Math.abs(change).toFixed(2)}`,
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

/** Renders a date as the day it describes, never as a moment. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
