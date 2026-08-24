/**
 * Instagram insights parsers.
 *
 * Fixtures are real responses captured on 2026-08-22, so the expected values
 * double as a record of where the account stood that day. Two of them exist to
 * pin down behaviour that is invisible from the outside and would otherwise
 * only be discovered in production:
 *
 * instagram-series-empty.json is what a metric with no daily series actually
 * returns. It is a 200 carrying an empty list, not an error, which is why the
 * parser has to be the thing that objects.
 *
 * instagram-media-page.json carries a mixed feed and reels page, proving both
 * that nested expansion filters metrics per item rather than failing the call,
 * and that a nested insight reports through values[0] while a direct one
 * reports through total_value.
 *
 * The captured payloads have had the access token stripped: Meta embeds a live
 * credential in its own paging.next link.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseDemographics,
  parseMediaPage,
  parseStories,
  parseTimeseries,
  parseTotalValue,
  recentPosts,
  startOfUtcDay,
  stripToken,
  isoDate,
} from "./instagram";
import { ParseError } from "./types";

const json = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8"));

describe("parseTimeseries", () => {
  it("reads the real reach series and dates each point", () => {
    const points = parseTimeseries(json("instagram-series-reach.json"), "reach");

    expect(points).toHaveLength(7);
    expect(points[0]).toEqual({ date: "2026-08-15", value: 23062 });
    expect(points.at(-1)).toEqual({ date: "2026-08-21", value: 116428 });
  });

  /*
   * The most valuable test here. Asking for a metric with no daily series
   * returns 200 and {"data": []}, so a parser that returned an empty array
   * would record nothing every day and report success every day. The only
   * signal available is the absence of points, so that has to be an error.
   */
  it("throws on a metric the API serves no series for, rather than returning nothing", () => {
    expect(() => parseTimeseries(json("instagram-series-empty.json"), "views")).toThrow(
      ParseError,
    );
  });

  it("throws when the series is present but carries no points", () => {
    const payload = { data: [{ name: "reach", period: "day", values: [] }] };
    expect(() => parseTimeseries(payload, "reach")).toThrow(/no daily points/);
  });

  it("skips a point with an unusable value rather than storing a guess", () => {
    const payload = {
      data: [
        {
          name: "reach",
          values: [
            { value: -1, end_time: "2026-08-20T07:00:00+0000" },
            { value: 12, end_time: "2026-08-21T07:00:00+0000" },
          ],
        },
      ],
    };
    expect(parseTimeseries(payload, "reach")).toEqual([{ date: "2026-08-21", value: 12 }]);
  });
});

describe("parseTotalValue", () => {
  it("reads the day's account totals", () => {
    const values = parseTotalValue(json("instagram-totals.json"));

    expect(values.reach).toBe(116428);
    expect(values.views).toBe(223921);
    expect(values.total_interactions).toBe(10893);
    expect(values.saves).toBe(1765);
  });

  /*
   * Every metric arrives with a title and description in the account's own
   * locale, which here is Russian. Storing those would put Cyrillic headings
   * on an English dashboard, so the parser must read name and value only.
   */
  it("ignores the API's own localised labels", () => {
    const raw = readFileSync(
      new URL("./__fixtures__/instagram-totals.json", import.meta.url),
      "utf8",
    );
    expect(raw).toMatch(/[Ѐ-ӿ]/);

    const values = parseTotalValue(json("instagram-totals.json"));
    expect(JSON.stringify(values)).not.toMatch(/[Ѐ-ӿ]/);
    expect(Object.values(values).every((value) => typeof value === "number")).toBe(true);
  });

  it("rejects a payload with no metric list", () => {
    expect(() => parseTotalValue({})).toThrow(ParseError);
  });
});

describe("parseMediaPage", () => {
  const posts = parseMediaPage(json("instagram-media-page.json"));

  it("reads a nested insight through values, not total_value", () => {
    // A nested expansion reports period "lifetime" with the figure in
    // values[0]; a direct /{id}/insights call reports the same figure in
    // total_value. Both shapes are live, so the parser tolerates both.
    expect(posts[0].reach).toBe(642);
  });

  it("gives a feed post the feed-only metrics and no watch time", () => {
    const feed = posts.find((post) => post.mediaProductType === "FEED");

    expect(feed).toBeDefined();
    expect(feed!.profileVisits).not.toBeNull();
    expect(feed!.follows).not.toBeNull();
    expect(feed!.avgWatchTimeMs).toBeNull();
  });

  /*
   * The API rejects profile_visits and follows for reels with a 400 when they
   * are asked for on their own, but silently omits them inside a nested
   * expansion. That is what lets one request cover a mixed page, and it is
   * also why null here means "not offered for this format" and must never be
   * rendered as a zero.
   */
  it("gives a reel its watch time and leaves the feed-only metrics null", () => {
    const reel = posts.find((post) => post.mediaProductType === "REELS");

    expect(reel).toBeDefined();
    expect(reel!.avgWatchTimeMs).toBe(4796);
    expect(reel!.totalWatchTimeMs).not.toBeNull();
    expect(reel!.profileVisits).toBeNull();
    expect(reel!.follows).toBeNull();
  });

  it("keeps both formats from one page", () => {
    expect(posts).toHaveLength(6);
    expect(new Set(posts.map((post) => post.mediaProductType))).toEqual(
      new Set(["FEED", "REELS"]),
    );
  });

  it("refuses a media item with no id", () => {
    expect(() => parseMediaPage({ data: [{ timestamp: "2026-08-22T00:00:00+0000" }] })).toThrow(
      ParseError,
    );
  });
});

describe("parseDemographics", () => {
  it("reads every country bucket", () => {
    const rows = parseDemographics(json("instagram-demographics-country.json"), "country");

    expect(rows).toHaveLength(45);
    // The API returns buckets unsorted, so the home market has to be found
    // rather than assumed to be first.
    expect(rows.find((row) => row.bucket === "UZ")?.followers).toBeGreaterThan(60_000);
    expect(rows.every((row) => row.breakdown === "country")).toBe(true);
  });

  it("throws when the breakdown is missing rather than reporting no followers", () => {
    expect(() => parseDemographics({ data: [{ total_value: {} }] }, "country")).toThrow(
      ParseError,
    );
  });
});

describe("parseStories", () => {
  it("reads a live story and its insights", () => {
    const stories = parseStories(json("instagram-stories.json"));

    expect(stories).toHaveLength(1);
    expect(stories[0].navigation).toBe(187);
    expect(stories[0].reach).toBe(167);
    expect(stories[0].mediaType).toBe("VIDEO");
  });

  it("treats no live stories as an ordinary answer", () => {
    expect(parseStories({ data: [] })).toEqual([]);
  });

  it("reports nulls, not zeroes, for a story with no insights attached", () => {
    const stories = parseStories({
      data: [{ id: "1", timestamp: "2026-08-22T11:00:00+0000", media_type: "IMAGE" }],
    });
    expect(stories[0].reach).toBeNull();
    expect(stories[0].views).toBeNull();
  });
});

describe("stripToken", () => {
  /*
   * Meta puts a live credential in its own paging links. Following one as
   * given would put the token back into a URL, and HttpError embeds the URL in
   * a message that reaches a table every signed-in user can read.
   */
  it("removes the credential Meta embeds in paging links", () => {
    const next = "https://graph.instagram.com/v23.0/17841/media?fields=id&access_token=SECRET";
    const stripped = stripToken(next);

    expect(stripped).not.toContain("SECRET");
    expect(stripped).not.toContain("access_token");
    expect(stripped).toContain("fields=id");
  });
});

describe("recentPosts", () => {
  const posts = parseMediaPage(json("instagram-media-page.json"));

  it("keeps posts whose counters are still moving", () => {
    const now = Date.parse("2026-08-22T12:00:00Z");
    expect(recentPosts(posts, now)).toHaveLength(posts.length);
  });

  it("drops posts old enough to have settled", () => {
    const now = Date.parse("2026-12-01T00:00:00Z");
    expect(recentPosts(posts, now)).toHaveLength(0);
  });
});

describe("startOfUtcDay", () => {
  it("truncates to the day so a rerun lands on the same row", () => {
    const day = startOfUtcDay(new Date("2026-08-22T23:59:59Z"));
    expect(day.toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(isoDate(day)).toBe("2026-08-22");
  });
});
