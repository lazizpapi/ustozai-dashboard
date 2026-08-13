import { describe, expect, it } from "vitest";

import { parsePlayReviews } from "./play-reviews";
import fixture from "./__fixtures__/play-reviews-uz.json";

/**
 * Fixture captured 2026-08-13 from a real google-play-scraper reviews() call
 * for uz.uztozedu.ustozai in Uzbek. Six reviews, scores 5,5,5,4,5,1, one with
 * an empty version string, which is what Play sends rather than omitting it.
 *
 * The point of testing the package's output at all: a package upgrade that
 * renames a field would otherwise fail silently, and an empty review list is
 * indistinguishable from an app nobody reviewed this week.
 */

describe("parsePlayReviews", () => {
  it("maps a real payload onto the shared Review shape", () => {
    const reviews = parsePlayReviews(fixture, "uz");

    expect(reviews).toHaveLength(6);
    expect(reviews[0]).toMatchObject({
      platform: "android",
      storeId: "uz.uztozedu.ustozai",
      country: "uz",
      rating: 5,
    });
    expect(reviews[0].storeReviewId).toBeTruthy();
    expect(reviews[0].body).toBeTruthy();
  });

  it("records the language in the country field, not a location", () => {
    // Play publishes no reviewer country. Storing the queried language is the
    // honest value; see the reviews.country comment in migration 0006.
    expect(parsePlayReviews(fixture, "ru").every((r) => r.country === "ru")).toBe(true);
  });

  it("normalises submittedAt to an ISO timestamp", () => {
    const [first] = parsePlayReviews(fixture, "uz");
    expect(first.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts a Date object as well as a string, since Play has sent both", () => {
    const [review] = parsePlayReviews(
      [{ id: "x", score: 5, date: new Date("2026-08-12T10:00:00Z") }],
      "uz",
    );
    expect(review.submittedAt).toBe("2026-08-12T10:00:00.000Z");
  });

  it("turns an empty version string into null rather than empty text", () => {
    const [review] = parsePlayReviews([{ id: "x", score: 4, version: "" }], "uz");
    expect(review.version).toBeNull();
  });

  it("keeps title null, because Play reviews have no titles", () => {
    expect(parsePlayReviews(fixture, "uz").every((r) => r.title === null)).toBe(true);
  });

  it("preserves a 1 star review rather than dropping it", () => {
    // The rows that matter most for a product team are the ones a lenient
    // parser is most likely to lose.
    expect(parsePlayReviews(fixture, "uz").some((r) => r.rating === 1)).toBe(true);
  });

  it("throws when the payload is not an array", () => {
    expect(() => parsePlayReviews({ data: [] }, "uz")).toThrow(/expected an array/);
  });

  it("throws on an entry with no id, rather than skipping it", () => {
    // A renamed field would make every entry idless at once. Throwing turns
    // that into a failed collector run instead of an empty review page.
    expect(() => parsePlayReviews([{ score: 5 }], "uz")).toThrow(/no usable id/);
  });

  it("throws on a rating outside 1 to 5", () => {
    expect(() => parsePlayReviews([{ id: "x", score: 0 }], "uz")).toThrow(/rating 0/);
    expect(() => parsePlayReviews([{ id: "x", score: 7 }], "uz")).toThrow(/rating 7/);
  });

  it("throws when the rating is missing entirely", () => {
    expect(() => parsePlayReviews([{ id: "x" }], "uz")).toThrow(/rating undefined/);
  });

  it("returns an empty list for an empty payload without throwing", () => {
    // Genuinely no reviews in that language is an ordinary answer.
    expect(parsePlayReviews([], "ru")).toEqual([]);
  });
});
