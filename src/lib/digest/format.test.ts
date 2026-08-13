import { describe, expect, it } from "vitest";

import { formatDigest, type DigestInput } from "./format";

const base: DigestInput = {
  date: "2026-08-11",
  rank: { current: 21, previous: 24, feedSize: 100 },
  iosRating: { current: 4.69, previous: 4.68, count: 1178 },
  androidRating: { current: 4.76, previous: 4.76, count: 10288 },
  iosDownloads: { date: "2026-08-10", units: 412 },
  androidInstalls: { date: "2026-08-10", units: 1043 },
  newReviews: [],
  audience: [],
  tokenExpiresInDays: null,
  failures: [],
};

const digest = (overrides: Partial<DigestInput> = {}) =>
  formatDigest({ ...base, ...overrides });

describe("formatDigest", () => {
  it("leads with the chart position", () => {
    expect(digest()).toContain("<b>#21</b> in Education, Uzbekistan");
  });

  it("treats a falling rank number as an improvement", () => {
    // 24 to 21 is movement up the chart even though the number went down.
    expect(digest()).toContain("up 3 on the week");
    expect(digest({ rank: { current: 30, previous: 21, feedSize: 100 } })).toContain(
      "down 9 on the week",
    );
  });

  it("says there is no week-ago reading rather than implying no change", () => {
    // These are opposite meanings and look identical if you are careless.
    const fresh = digest({ rank: { current: 21, previous: null, feedSize: 100 } });
    expect(fresh).toContain("no week-ago reading yet");
    expect(fresh).not.toContain("flat on the week");

    expect(digest({ rank: { current: 21, previous: 21, feedSize: 100 } })).toContain(
      "flat on the week",
    );
  });

  it("reports being outside the chart as a fact, not a missing value", () => {
    const out = digest({ rank: { current: null, previous: null, feedSize: 100 } });
    expect(out).toContain("Outside the top 100");
  });

  it("dates every download figure so none of it reads as live", () => {
    const text = digest();
    expect(text).toContain("iOS 412 on 2026-08-10");
    expect(text).toContain("Android 1,043 on 2026-08-10");
  });

  it("explains why iOS downloads are absent instead of showing nothing", () => {
    expect(digest({ iosDownloads: null })).toContain("App Store Connect key not connected");
  });

  it("pulls out reviews at three stars and below", () => {
    const text = digest({
      newReviews: [
        { rating: 5, title: "Zo'r", body: null, country: "uz" },
        { rating: 2, title: "Sekin ishlayapti", body: null, country: "uz" },
      ],
    });

    expect(text).toContain("2 new, 1 at 3 stars or below");
    expect(text).toContain("Sekin ishlayapti");
  });

  it("lists audience counts with weekly movement", () => {
    const text = digest({
      audience: [
        { platform: "telegram", current: 50389, previous: 50100, isExact: true },
        { platform: "youtube", current: 174000, previous: 174000, isExact: false },
      ],
    });

    expect(text).toContain("Telegram 50,389 (+289 this week)");
    // YouTube rounds, so the digest says so rather than implying precision.
    expect(text).toContain("Youtube about 174,000");
  });

  it("omits the audience block entirely when nothing was collected", () => {
    expect(digest()).not.toContain("Audience");
  });

  it("demands action when the Instagram credential is about to die", () => {
    // Past 60 days the token cannot be refreshed by any automation, so this
    // has to reach a person while there is still time to act.
    const text = digest({ tokenExpiresInDays: 9 });

    expect(text).toContain("Action needed");
    expect(text).toContain("expires in 9 days");
  });

  it("says nothing about the token when it is healthy", () => {
    expect(digest()).not.toContain("Action needed");
  });

  it("surfaces collector failures", () => {
    expect(digest({ failures: ["itunes-charts:uz: 500"] })).toContain("Collector problems");
  });

  it("escapes HTML so review text cannot break the message", () => {
    const text = digest({
      newReviews: [{ rating: 1, title: "<b>bad</b> & broken", body: null, country: "uz" }],
    });

    expect(text).toContain("&lt;b&gt;bad&lt;/b&gt; &amp; broken");
  });

  it("contains no em-dashes or en-dashes anywhere", () => {
    // House style, and it applies to generated copy as much as handwritten.
    const text = digest({
      newReviews: [{ rating: 1, title: "x", body: null, country: "uz" }],
      failures: ["a: b"],
    });

    expect(text).not.toMatch(/[—–]/);
  });
});
