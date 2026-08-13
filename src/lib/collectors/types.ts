/**
 * Records produced by collectors.
 *
 * Collectors are pure: they fetch, validate, and return these. They never touch
 * the database. All writes go through src/lib/db/persist.ts. That split is what
 * lets every parser be unit tested against a saved fixture with no network and
 * no Supabase.
 */

export type Platform = "ios" | "android";

export interface MetricSnapshot {
  platform: Platform;
  storeId: string;
  country: string;
  rating: number | null;
  ratingCount: number | null;
  /** Google Play only. Apple publishes no install count at any tier. */
  installCount: number | null;
  /** The rounded string Play shows, e.g. "500K+". */
  installLabel: string | null;
  version: string | null;
}

export interface ChartRank {
  platform: Platform;
  storeId: string;
  country: string;
  chartType: string;
  genre: string;
  /**
   * null means the poll succeeded and the app was outside the feed. A failed
   * poll produces no record at all, so this is never ambiguous.
   */
  rank: number | null;
  feedSize: number;
}

export interface KeywordRank {
  platform: Platform;
  storeId: string;
  country: string;
  keyword: string;
  /** null means we searched and the app did not appear. */
  position: number | null;
  resultCount: number;
}

export interface Review {
  platform: Platform;
  storeId: string;
  country: string;
  storeReviewId: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: string | null;
  version: string | null;
  submittedAt: string | null;
}

/** Thrown when a payload parses as JSON but is not the shape we expect. */
export class ParseError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = "ParseError";
  }
}
