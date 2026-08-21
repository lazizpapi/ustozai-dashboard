/**
 * Live endpoint checks. Excluded from `npm test`; run with `npm run test:live`.
 *
 * The fixture tests prove the parsers are correct. They cannot tell you that
 * Apple retired the undocumented RSS feed this dashboard depends on, or that
 * Play reshuffled its bootstrap payload. This file is the canary for that, and
 * it is worth running before blaming the database for a flat chart.
 *
 * Assertions are deliberately loose. Real numbers move; the point is that each
 * endpoint still answers in a shape we can read.
 */

import { describe, expect, it } from "vitest";

import { fetchLookup } from "./itunes-lookup";
import { fetchChart } from "./itunes-charts";
import { fetchSearch } from "./itunes-search";
import { fetchLatestReviews, fetchReviews, PULSE_REVIEW_FETCH } from "./itunes-reviews";
import { fetchPlayDetails } from "./play-details";
import { EDUCATION_GENRE } from "./config";
import { worstCaseEmptyRetryMs } from "./http";

const TIMEOUT = 45_000;

describe("live endpoints", () => {
  it(
    "iTunes Lookup still returns a rating for the UZ storefront",
    async () => {
      const snapshot = await fetchLookup("uz");

      expect(snapshot).not.toBeNull();
      expect(snapshot!.rating).toBeGreaterThan(0);
      expect(snapshot!.rating).toBeLessThanOrEqual(5);
      expect(snapshot!.ratingCount).toBeGreaterThan(1000);
    },
    TIMEOUT,
  );

  it(
    "the legacy Education chart feed still exists and is genre-filtered",
    async () => {
      const rank = await fetchChart({
        country: "uz",
        feed: "topfreeapplications",
        genre: EDUCATION_GENRE,
        chartType: "topfree",
      });

      // If Apple ever drops genre support the way the newer marketingtools host
      // did, this feed would return the overall chart and shrink or vanish.
      expect(rank.feedSize).toBeGreaterThan(50);
      if (rank.rank !== null) expect(rank.rank).toBeLessThanOrEqual(rank.feedSize);
    },
    TIMEOUT,
  );

  it(
    "search still places the app for its own brand term",
    async () => {
      const result = await fetchSearch("ustoz", "uz");

      expect(result.resultCount).toBeGreaterThan(0);
      expect(result.position).not.toBeNull();
    },
    TIMEOUT,
  );

  it(
    "the reviews feed yields something across its retries",
    async () => {
      // This is the flakiest endpoint in the set. fetchReviews retries an empty
      // first page, so a failure here means sustained emptiness, not one blip.
      const reviews = await fetchReviews("uz");

      expect(reviews.length).toBeGreaterThan(0);
      expect(new Set(reviews.map((r) => r.storeReviewId)).size).toBe(reviews.length);
    },
    TIMEOUT,
  );

  it(
    "page one still answers inside the pulse's much tighter budget",
    async () => {
      // The pulse spends a fraction of what the walk above may spend, so this
      // is the canary for the trade actually being viable: if Apple gets slow
      // enough that four seconds an attempt stops landing, the reviews on the
      // wall go stale while every fixture test stays green.
      const started = Date.now();
      const reviews = await fetchLatestReviews("uz");
      const elapsed = Date.now() - started;

      expect(reviews.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(worstCaseEmptyRetryMs(PULSE_REVIEW_FETCH));
    },
    TIMEOUT,
  );

  it(
    "Play still exposes an exact install count",
    async () => {
      const snapshot = await fetchPlayDetails("uz");

      expect(snapshot.installCount).toBeGreaterThan(400_000);
      expect(snapshot.rating).toBeGreaterThan(4);
      expect(snapshot.installLabel).toMatch(/\+$/);
    },
    TIMEOUT,
  );
});
