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
import {
  parseChart,
  parseChartMany,
  parseChartTop,
  type ChartQuery,
} from "./itunes-charts";
import { parseSearch } from "./itunes-search";
import { IOS_APP_ID } from "./config";
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

describe("competitor tracking", () => {
  const query: ChartQuery = {
    country: "uz",
    feed: "topfreeapplications",
    genre: "6017",
    chartType: "topfree",
  };

  it("reads several apps out of one chart payload", () => {
    // This is what makes competitor ranks free: the feed is the same hundred
    // entries whoever is asking, so it is fetched once and read many times.
    const payload = fixture("itunes-chart-uz-education.json");
    const ours = parseChart(payload, query);
    const many = parseChartMany(payload, query, [IOS_APP_ID, "000000000"]);

    expect(many).toHaveLength(2);
    expect(many[0].rank).toBe(ours.rank);
    expect(many[0].storeId).toBe(IOS_APP_ID);
  });

  it("reports an app missing from the feed as null rank, not as absent", () => {
    // Null means polled fine and outside the chart. A competitor that drops out
    // must be distinguishable from one we failed to read.
    const [missing] = parseChartMany(
      fixture("itunes-chart-uz-education.json"),
      query,
      ["000000000"],
    );

    expect(missing.rank).toBeNull();
    expect(missing.feedSize).toBeGreaterThan(0);
  });

  it("attributes a lookup to the app that was requested", () => {
    // The bug this pins: the fallback used to be our own app id, so a
    // competitor response without trackId would have overwritten our rating
    // with theirs, and every panel downstream would have shown it.
    const withoutId = { resultCount: 1, results: [{ averageUserRating: 4.42 }] };

    expect(parseLookup(withoutId, "uz", "6504232456")?.storeId).toBe("6504232456");
    expect(parseLookup(withoutId, "uz")?.storeId).toBe(IOS_APP_ID);
  });
});

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

describe("parseChartTop", () => {
  it("reads the whole top of the chart, ranked from one", () => {
    // The same payload the rank poll already fetches. Storing the top of it is
    // what turns "where are we" into "who is around us and who is moving".
    const top = parseChartTop(fixture("itunes-chart-uz-education.json"), CHART_QUERY);

    expect(top).toHaveLength(20);
    expect(top[0]).toMatchObject({
      rank: 1,
      storeId: "6557054918",
      name: "Qizlar Akademiyasi",
      country: "uz",
      chartType: "topfree",
    });
    expect(top[19]).toMatchObject({ rank: 20, name: "Iqra: Quran Tutor" });
  });

  it("clamps to the feed when asked for more than exists", () => {
    const payload = fixture("itunes-chart-uz-education.json");
    expect(parseChartTop(payload, CHART_QUERY, 500)).toHaveLength(100);
  });

  it("returns nothing for an empty chart rather than throwing", () => {
    expect(parseChartTop({ feed: {} }, CHART_QUERY)).toEqual([]);
  });

  it("keeps the rank of later entries when one is malformed", () => {
    // A dropped entry must leave a visible gap, never renumber the apps below
    // it: rank is a statement about the chart, not about our parse.
    const payload = fixture("itunes-chart-uz-education.json");
    const broken = {
      feed: { entry: [{ title: { label: "no id" } }, ...payload.feed.entry.slice(1)] },
    };

    const top = parseChartTop(broken, CHART_QUERY, 3);
    expect(top.map((row) => row.rank)).toEqual([2, 3]);
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
