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
import {
  fetchInstagramDemographics,
  fetchInstagramPosts,
  fetchInstagramSeries,
  fetchInstagramStories,
  fetchInstagramTotals,
} from "./instagram";
import { ParseError } from "./types";

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

/**
 * Instagram, which needs a credential and so is skipped without one.
 *
 * Run with a token in the environment:
 *   INSTAGRAM_ACCESS_TOKEN=... npm run test:live
 *
 * These exist because the fixture tests prove the parsers read a saved payload
 * correctly and can say nothing at all about whether Meta still sends that
 * payload. Two of the assertions below are unusual and deliberate: one asserts
 * that a metric still returns nothing, because the whole design rests on
 * knowing which metrics have a daily series and which only pretend to.
 */
describe("live Instagram", () => {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const withToken = token ? it : it.skip;

  const since = new Date(Date.now() - 7 * 86_400_000);
  const until = new Date();

  withToken(
    "still serves reach as a daily series, and accepts a bearer header",
    async () => {
      const points = await fetchInstagramSeries(token!, "reach", since, until);

      expect(points.length).toBeGreaterThan(3);
      expect(points.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date))).toBe(true);
      expect(points.every((point) => point.value >= 0)).toBe(true);
    },
    TIMEOUT,
  );

  /*
   * An assertion that something still does NOT work.
   *
   * views accepts period=day and answers 200 with an empty list. Every
   * decision about how this data is collected follows from that, so if Meta
   * ever starts serving it as a series we want to hear about it from a test
   * rather than never. The failure of this test is good news.
   */
  withToken(
    "still refuses to serve views as a daily series",
    async () => {
      await expect(fetchInstagramSeries(token!, "views" as "reach", since, until)).rejects.toThrow(
        ParseError,
      );
    },
    TIMEOUT,
  );

  withToken(
    "still totals the account metrics for a single day",
    async () => {
      const totals = await fetchInstagramTotals(token!, new Date(Date.now() - 86_400_000));

      expect(totals.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(totals.values.views).toBeGreaterThan(0);
      expect(totals.values.reach).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  /*
   * The economics of the whole media collector rest on this: one request
   * returns a mixed page of feed posts and reels, each carrying only the
   * metrics that exist for its format. If Meta ever starts rejecting the union
   * outright, this fails and the collector needs splitting by format.
   */
  withToken(
    "still returns a mixed page of posts with their insights attached",
    async () => {
      const posts = await fetchInstagramPosts(token!, { pages: 1 });

      expect(posts.length).toBeGreaterThan(10);
      expect(posts.some((post) => post.mediaProductType === "REELS")).toBe(true);
      expect(posts.some((post) => post.mediaProductType === "FEED")).toBe(true);
      expect(posts.some((post) => post.reach !== null)).toBe(true);

      const reel = posts.find((post) => post.mediaProductType === "REELS");
      expect(reel?.profileVisits).toBeNull();
    },
    TIMEOUT,
  );

  withToken(
    "still breaks the followers down four ways",
    async () => {
      const rows = await fetchInstagramDemographics(token!);

      expect(new Set(rows.map((row) => row.breakdown))).toEqual(
        new Set(["country", "city", "age", "gender"]),
      );
      expect(rows.find((row) => row.breakdown === "country" && row.bucket === "UZ")?.followers)
        .toBeGreaterThan(1000);
    },
    TIMEOUT,
  );

  withToken(
    "answers the stories endpoint, whether or not one is live",
    async () => {
      // An empty list is the ordinary answer for most hours of the day, so the
      // assertion is about the shape rather than the count.
      await expect(fetchInstagramStories(token!)).resolves.toBeInstanceOf(Array);
    },
    TIMEOUT,
  );
});
