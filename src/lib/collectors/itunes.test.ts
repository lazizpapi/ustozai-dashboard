/**
 * Parser tests for the four iTunes collectors.
 *
 * Every fixture is a real response captured on 2026-08-11, so the expected
 * values below double as a record of where the app actually stood that day.
 * No network here: these exercise the pure parse functions only.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseLookup } from "./itunes-lookup";
import { parseChart, type ChartQuery } from "./itunes-charts";
import { parseSearch } from "./itunes-search";
import { parseReviews } from "./itunes-reviews";
import { ParseError } from "./types";
import { EDUCATION_GENRE } from "./config";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));

const CHART_QUERY: ChartQuery = {
  country: "uz",
  feed: "topfreeapplications",
  genre: EDUCATION_GENRE,
  chartType: "topfree",
};

describe("parseLookup", () => {
  it("reads rating, count and version from a real UZ response", () => {
    const snapshot = parseLookup(fixture("itunes-lookup-uz.json"), "uz");

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rating).toBeCloseTo(4.68761, 5);
    expect(snapshot!.ratingCount).toBe(1178);
    expect(snapshot!.version).toBe("2.2.6");
    expect(snapshot!.platform).toBe("ios");
    // Apple never reports installs. Guard against a future refactor inventing one.
    expect(snapshot!.installCount).toBeNull();
  });

  it("returns null when the app is not sold in that storefront", () => {
    expect(parseLookup({ resultCount: 0, results: [] }, "jp")).toBeNull();
  });

  it("throws when the payload is not a lookup response", () => {
    expect(() => parseLookup({ error: "nope" }, "uz")).toThrow(ParseError);
  });
});

describe("parseChart", () => {
  const chart = fixture("itunes-chart-uz-education.json");

  it("finds the app's position in the UZ Education chart", () => {
    const rank = parseChart(chart, CHART_QUERY);

    expect(rank.rank).toBe(21);
    expect(rank.feedSize).toBe(100);
    expect(rank.genre).toBe(EDUCATION_GENRE);
  });

  it("reports rank null, not a failure, when the app is outside the feed", () => {
    // Same feed with our entry removed: this is the "outside the top 100" case,
    // which must stay distinguishable from a broken poll.
    const withoutApp = {
      feed: {
        entry: chart.feed.entry.filter(
          (e: { id: { attributes: { "im:id": string } } }) =>
            e.id.attributes["im:id"] !== "6504815934",
        ),
      },
    };

    const rank = parseChart(withoutApp, CHART_QUERY);

    expect(rank.rank).toBeNull();
    expect(rank.feedSize).toBe(99);
  });

  it("treats an absent entry array as an empty chart", () => {
    const rank = parseChart({ feed: {} }, CHART_QUERY);

    expect(rank.rank).toBeNull();
    expect(rank.feedSize).toBe(0);
  });

  it("throws when the payload has no feed at all", () => {
    expect(() => parseChart({}, CHART_QUERY)).toThrow(ParseError);
  });
});

describe("parseSearch", () => {
  it("places the app first for its own brand term", () => {
    const result = parseSearch(fixture("itunes-search-uz-ustoz.json"), "ustoz", "uz");

    expect(result.position).toBe(1);
    expect(result.resultCount).toBeGreaterThan(0);
  });

  it("reports position null when the app does not appear", () => {
    const result = parseSearch(
      { resultCount: 2, results: [{ trackId: 1 }, { trackId: 2 }] },
      "matematika",
      "uz",
    );

    expect(result.position).toBeNull();
    expect(result.resultCount).toBe(2);
  });

  it("throws when the payload has no results array", () => {
    expect(() => parseSearch({}, "ustoz", "uz")).toThrow(ParseError);
  });
});

describe("parseReviews", () => {
  it("parses a full page of reviews", () => {
    const reviews = parseReviews(fixture("itunes-reviews-uz.json"), "uz");

    expect(reviews).toHaveLength(50);
    for (const review of reviews) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(review.storeReviewId).toBeTruthy();
    }
    expect(reviews[0].submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns an empty array for the intermittently empty feed", () => {
    // This fixture is a genuine response: the feed goes empty at random and
    // must never be read as "this app has no reviews".
    expect(parseReviews(fixture("itunes-reviews-empty.json"), "uz")).toEqual([]);
  });

  it("handles a single review arriving as an object rather than an array", () => {
    const single = {
      feed: {
        entry: {
          id: { label: "999" },
          "im:rating": { label: "4" },
          title: { label: "Yaxshi" },
          content: { label: "Zo'r ilova" },
          author: { name: { label: "Dilnoza" } },
          "im:version": { label: "2.2.6" },
          updated: { label: "2026-08-10T09:00:00-07:00" },
        },
      },
    };

    const reviews = parseReviews(single, "uz");

    expect(reviews).toHaveLength(1);
    expect(reviews[0].rating).toBe(4);
    expect(reviews[0].author).toBe("Dilnoza");
  });

  it("skips entries with no rating, such as the app metadata row", () => {
    const mixed = {
      feed: {
        entry: [
          { id: { label: "app" }, title: { label: "Ustoz AI" } },
          { id: { label: "1" }, "im:rating": { label: "5" } },
        ],
      },
    };

    expect(parseReviews(mixed, "uz")).toHaveLength(1);
  });

  it("throws when the payload has no feed", () => {
    expect(() => parseReviews({}, "uz")).toThrow(ParseError);
  });
});
