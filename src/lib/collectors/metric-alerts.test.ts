import { describe, expect, it } from "vitest";

import {
  checkDownloadSlump,
  checkDownloadSurge,
  checkFollowerMove,
  checkRankDrop,
  checkRankImprovement,
  checkRatingDrop,
  checkRatingRise,
  checkSeriesMove,
  completeDays,
  formatMetricAlert,
} from "./metric-alerts";

/**
 * The rules that decide whether a number moving is worth a message.
 *
 * Every figure here is invented. What is real is the shape of each case: a
 * rank that slid, a rank that vanished, a launch spike that must not turn the
 * following fortnight into a stream of false slumps, and a rounded follower
 * count that must not report its own rounding as growth.
 */

const RANK = { key: "education_rank_ios", label: "Education, App Store" } as const;
const PLAY = { key: "education_rank_android", label: "Education, Google Play" } as const;
const DOWNLOADS = { key: "ios_downloads", label: "App Store downloads" } as const;
const RATING = { key: "ios_rating", label: "App Store rating" } as const;
const TELEGRAM = { key: "telegram_members", label: "Telegram members" } as const;
const REVENUE = { key: "revenue", label: "Takings" } as const;

const DAY = "2026-08-27";

describe("checkRankDrop", () => {
  it("fires when the app slides more than the threshold", () => {
    expect(checkRankDrop(RANK, DAY, 12, 4)).toEqual({
      metric: "Education, App Store",
      metricKey: "education_rank_ios",
      direction: "down",
      date: DAY,
      magnitude: { current: 12, previous: 4 },
      detail: "#12, down 8 places from #4 yesterday",
    });
  });

  it("stays quiet for ordinary daily jitter", () => {
    // Five places is the threshold, so five places is not yet news.
    expect(checkRankDrop(RANK, DAY, 9, 4)).toBeNull();
  });

  it("never fires on good news", () => {
    expect(checkRankDrop(RANK, DAY, 3, 20)).toBeNull();
  });

  it("treats falling out of the chart as the loudest case", () => {
    const alert = checkRankDrop(PLAY, DAY, null, 5, 100);

    expect(alert).toEqual({
      metric: "Education, Google Play",
      metricKey: "education_rank_android",
      direction: "down",
      date: DAY,
      magnitude: { current: null, previous: 5 },
      detail: "outside the top 100, was #5 yesterday",
    });
  });

  it("says chart rather than a made-up size when the feed size is unknown", () => {
    expect(checkRankDrop(RANK, DAY, null, 5)?.detail).toBe(
      "outside the chart, was #5 yesterday",
    );
  });

  it("says nothing when there is nothing to compare against", () => {
    // Never charted, still not charted. Not news.
    expect(checkRankDrop(RANK, DAY, null, null)).toBeNull();
    // Arriving on the chart is the improvement rule's business, not this one's.
    expect(checkRankDrop(RANK, DAY, 30, null)).toBeNull();
  });
});

describe("checkRankImprovement", () => {
  it("fires when the app climbs more than the threshold", () => {
    expect(checkRankImprovement(RANK, DAY, 4, 12)).toEqual({
      metric: "Education, App Store",
      metricKey: "education_rank_ios",
      direction: "up",
      date: DAY,
      magnitude: { current: 4, previous: 12 },
      detail: "#4, up 8 places from #12 yesterday",
    });
  });

  it("stays quiet for ordinary daily jitter", () => {
    expect(checkRankImprovement(RANK, DAY, 4, 9)).toBeNull();
  });

  it("never fires on bad news", () => {
    expect(checkRankImprovement(RANK, DAY, 20, 3)).toBeNull();
  });

  it("treats arriving on the chart as the loudest good news", () => {
    /*
     * The case most likely to be missed: there is no previous number sitting
     * next to it looking wrong, so nothing on the page draws the eye to it.
     */
    expect(checkRankImprovement(PLAY, DAY, 42, null, 100)).toEqual({
      metric: "Education, Google Play",
      metricKey: "education_rank_android",
      direction: "up",
      date: DAY,
      magnitude: { current: 42, previous: null },
      detail: "#42, was outside the top 100 yesterday",
    });
  });

  it("says nothing when the app is still off the chart", () => {
    expect(checkRankImprovement(RANK, DAY, null, null)).toBeNull();
    // Falling off is the drop rule's business.
    expect(checkRankImprovement(RANK, DAY, null, 5)).toBeNull();
  });
});

describe("checkDownloadSlump", () => {
  const steady = (count: number, downloads = 100) =>
    Array.from({ length: count }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      downloads,
    }));

  it("fires when a day falls well under the fortnight around it", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 20 }];

    expect(checkDownloadSlump(DOWNLOADS, days)).toEqual({
      metric: "App Store downloads",
      metricKey: "ios_downloads",
      direction: "down",
      date: "2026-08-11",
      magnitude: { current: 20, previous: 100 },
      detail: "20 on 2026-08-11, against a typical 100 a day",
    });
  });

  it("leaves an ordinary dip alone", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 70 }];

    expect(checkDownloadSlump(DOWNLOADS, days)).toBeNull();
  });

  it("is not fooled by a launch spike", () => {
    /*
     * The median is the whole point of this rule. One enormous day among
     * steady hundreds pulls a mean far above them, and every ordinary day
     * afterwards would read as a slump against it.
     */
    const days = [
      ...steady(9),
      { date: "2026-08-10", downloads: 50_000 },
      { date: "2026-08-11", downloads: 95 },
    ];

    expect(checkDownloadSlump(DOWNLOADS, days)).toBeNull();
  });

  it("waits for enough history before calling anything typical", () => {
    const days = [...steady(3), { date: "2026-08-04", downloads: 1 }];

    expect(checkDownloadSlump(DOWNLOADS, days)).toBeNull();
  });

  it("reports the day it crosses, then stays quiet", () => {
    /*
     * A slump that lasts is one piece of news. Reporting it every morning is
     * how the channel gets muted, so the rule fires on the crossing only.
     */
    const crossed = [...steady(10), { date: "2026-08-11", downloads: 20 }];
    expect(checkDownloadSlump(DOWNLOADS, crossed)).not.toBeNull();

    const stillDown = [...crossed, { date: "2026-08-12", downloads: 18 }];
    expect(checkDownloadSlump(DOWNLOADS, stillDown)).toBeNull();
  });

  it("reports again once it recovers and slumps a second time", () => {
    const days = [
      ...steady(10),
      { date: "2026-08-11", downloads: 20 },
      { date: "2026-08-12", downloads: 105 },
      { date: "2026-08-13", downloads: 19 },
    ];

    expect(checkDownloadSlump(DOWNLOADS, days)).not.toBeNull();
  });

  it("does not divide by a fortnight of zeroes", () => {
    const days = [...steady(10, 0), { date: "2026-08-11", downloads: 0 }];

    expect(checkDownloadSlump(DOWNLOADS, days)).toBeNull();
  });

  it("never reports a surge, however big", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 9_000 }];

    expect(checkDownloadSlump(DOWNLOADS, days)).toBeNull();
  });
});

describe("checkDownloadSurge", () => {
  const steady = (count: number, downloads = 100) =>
    Array.from({ length: count }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      downloads,
    }));

  it("fires when a day doubles the fortnight around it", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 240 }];

    expect(checkDownloadSurge(DOWNLOADS, days)).toEqual({
      metric: "App Store downloads",
      metricKey: "ios_downloads",
      direction: "up",
      date: "2026-08-11",
      magnitude: { current: 240, previous: 100 },
      detail: "240 on 2026-08-11, against a typical 100 a day",
    });
  });

  it("leaves an ordinary good day alone", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 150 }];

    expect(checkDownloadSurge(DOWNLOADS, days)).toBeNull();
  });

  it("reports the day it crosses, then stays quiet", () => {
    /*
     * The mirror of the slump debounce. A week of good days after a feature is
     * one piece of news; hearing about it every morning for a week is not.
     */
    const crossed = [...steady(10), { date: "2026-08-11", downloads: 240 }];
    expect(checkDownloadSurge(DOWNLOADS, crossed)).not.toBeNull();

    const stillUp = [...crossed, { date: "2026-08-12", downloads: 260 }];
    expect(checkDownloadSurge(DOWNLOADS, stillUp)).toBeNull();
  });

  it("never reports a slump", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 2 }];

    expect(checkDownloadSurge(DOWNLOADS, days)).toBeNull();
  });
});

describe("checkSeriesMove", () => {
  const steady = (count: number, value: number) =>
    Array.from({ length: count }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      value,
    }));

  const BOUNDS = { slumpShare: 0.4, surgeShare: 2 };

  it("names the unit where a bare number would not mean anything", () => {
    const days = [...steady(10, 3_000_000), { date: "2026-08-11", value: 9_000_000 }];

    expect(
      checkSeriesMove(REVENUE, days, { ...BOUNDS, unit: "UZS" })?.detail,
    ).toBe("9000000 UZS on 2026-08-11, against a typical 3000000 UZS a day");
  });

  it("reports a recovery the morning after a slump", () => {
    /*
     * The reason suppression is direction-aware. Collapsing a slump and the
     * surge that follows it into one message would hide the recovery, which is
     * the half somebody actually wants to hear about.
     */
    const days = [
      ...steady(10, 100),
      { date: "2026-08-11", value: 20 },
      { date: "2026-08-12", value: 260 },
    ];

    expect(checkSeriesMove(DOWNLOADS, days, BOUNDS)?.direction).toBe("up");
  });
});

describe("checkRatingDrop", () => {
  it("fires on a fall of a hundredth or more", () => {
    expect(checkRatingDrop(RATING, DAY, 4.62, 4.68)).toEqual({
      metric: "App Store rating",
      metricKey: "ios_rating",
      direction: "down",
      date: DAY,
      magnitude: { current: 4.62, previous: 4.68 },
      detail: "4.62, down from 4.68",
    });
  });

  it("ignores a fall too small to mean anything", () => {
    expect(checkRatingDrop(RATING, DAY, 4.67, 4.68)).toBeNull();
  });

  it("never fires on a rating going up", () => {
    expect(checkRatingDrop(RATING, DAY, 4.75, 4.68)).toBeNull();
  });

  it("says nothing without both readings", () => {
    expect(checkRatingDrop(RATING, DAY, null, 4.68)).toBeNull();
    expect(checkRatingDrop(RATING, DAY, 4.68, null)).toBeNull();
  });
});

describe("checkRatingRise", () => {
  it("fires on a rise of a hundredth or more", () => {
    expect(checkRatingRise(RATING, DAY, 4.74, 4.68)).toEqual({
      metric: "App Store rating",
      metricKey: "ios_rating",
      direction: "up",
      date: DAY,
      magnitude: { current: 4.74, previous: 4.68 },
      detail: "4.74, up from 4.68",
    });
  });

  it("ignores a rise too small to mean anything", () => {
    expect(checkRatingRise(RATING, DAY, 4.69, 4.68)).toBeNull();
  });

  it("never fires on a rating going down", () => {
    expect(checkRatingRise(RATING, DAY, 4.5, 4.68)).toBeNull();
  });
});

describe("checkFollowerMove", () => {
  it("fires on a gain past both the share and the floor", () => {
    expect(checkFollowerMove(TELEGRAM, DAY, 60_000, 58_000)).toEqual({
      metric: "Telegram members",
      metricKey: "telegram_members",
      direction: "up",
      date: DAY,
      magnitude: { current: 60_000, previous: 58_000 },
      detail: "60000, up 2000 from 58000 yesterday",
    });
  });

  it("fires the same way on a loss", () => {
    const move = checkFollowerMove(TELEGRAM, DAY, 56_000, 58_000);

    expect(move?.direction).toBe("down");
    expect(move?.detail).toBe("56000, down 2000 from 58000 yesterday");
  });

  it("ignores a rounding step from a platform that publishes rounded counts", () => {
    /*
     * YouTube rounds to three significant figures, so at our size the number
     * moves in steps of a thousand on days when nothing happened. The share
     * threshold has to clear one of those steps comfortably.
     */
    expect(checkFollowerMove(TELEGRAM, DAY, 176_000, 175_000)).toBeNull();
  });

  it("ignores ordinary daily drift", () => {
    expect(checkFollowerMove(TELEGRAM, DAY, 58_300, 58_000)).toBeNull();
  });

  it("holds a small account to the absolute floor", () => {
    // Two per cent of 900 is 18, which is noise, not news.
    expect(checkFollowerMove(TELEGRAM, DAY, 940, 900)).toBeNull();
  });

  it("says nothing without both readings, or without a denominator", () => {
    expect(checkFollowerMove(TELEGRAM, DAY, null, 58_000)).toBeNull();
    expect(checkFollowerMove(TELEGRAM, DAY, 58_000, null)).toBeNull();
    expect(checkFollowerMove(TELEGRAM, DAY, 58_000, 0)).toBeNull();
  });
});

describe("formatMetricAlert", () => {
  it("returns null on a quiet day rather than an empty message", () => {
    expect(formatMetricAlert([])).toBeNull();
  });

  it("lists what moved", () => {
    const message = formatMetricAlert([
      { metric: "Education, App Store", detail: "#12, down 8 places from #4 yesterday" },
    ]);

    expect(message).toBe(
      "<b>Worth a look</b>\n  Education, App Store: #12, down 8 places from #4 yesterday",
    );
  });

  it("puts the note under the movement it explains", () => {
    const message = formatMetricAlert([
      {
        metric: "App Store downloads",
        detail: "240 on 2026-08-11, against a typical 100 a day",
        noteUz: "2.4 versiyasi ikki kun oldin chiqdi.",
      },
    ]);

    expect(message).toBe(
      "<b>Worth a look</b>\n" +
        "  App Store downloads: 240 on 2026-08-11, against a typical 100 a day\n" +
        "  <i>2.4 versiyasi ikki kun oldin chiqdi.</i>",
    );
  });

  it("escapes a note as carefully as anything else", () => {
    // The note is written by a model, which is perfectly capable of a stray
    // angle bracket. Unescaped, that is a rejected message, not a typo.
    const message = formatMetricAlert([
      { metric: "m", detail: "d", noteUz: "o'sish <b>katta</b> & tez" },
    ]);

    expect(message).toContain("&lt;b&gt;katta&lt;/b&gt; &amp; tez");
  });

  it("cuts a note that was not written for a phone", () => {
    const message = formatMetricAlert([
      { metric: "m", detail: "d", noteUz: "u".repeat(400) },
    ]);

    expect(message).toContain("...");
    expect(message!.length).toBeLessThan(400);
  });

  it("escapes anything that would break the markup", () => {
    const message = formatMetricAlert([{ metric: "A & B", detail: "<b>x</b>" }]);

    expect(message).toContain("A &amp; B");
    expect(message).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("caps the list so the message stays readable on a phone", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      metric: `metric ${index}`,
      detail: "moved",
    }));

    expect(formatMetricAlert(many)).toContain("and 3 more");
  });
});

describe("completeDays", () => {
  const days = [
    { date: "2026-08-25", value: 100 },
    { date: "2026-08-26", value: 110 },
    { date: "2026-08-27", value: 12 },
  ];

  it("drops the day still being counted", () => {
    /*
     * The one that matters. Takings and active users accumulate through the
     * day and the run fires at six in the morning, so today's row is a few
     * hours of a day. Left in, every morning reports a collapse.
     */
    expect(completeDays(days, "2026-08-27")).toEqual([
      { date: "2026-08-25", value: 100 },
      { date: "2026-08-26", value: 110 },
    ]);
  });

  it("leaves a series that is already behind alone", () => {
    // Apple publishes a day late, so nothing here is today's and nothing goes.
    expect(completeDays(days, "2026-08-28")).toHaveLength(3);
  });

  it("would rather return nothing than judge a part-day", () => {
    expect(completeDays([{ date: "2026-08-27", value: 12 }], "2026-08-27")).toEqual([]);
  });

  it("keeps a rule quiet instead of firing on a part-day", () => {
    const steady = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-08-${String(index + 15).padStart(2, "0")}`,
      value: 100,
    }));
    const withToday = [...steady, { date: "2026-08-25", value: 6 }];
    const bounds = { slumpShare: 0.4, surgeShare: 2 };

    // The part-day looks exactly like a collapse.
    expect(checkSeriesMove(DOWNLOADS, withToday, bounds)).not.toBeNull();
    // Filtered out, there is nothing to report.
    expect(
      checkSeriesMove(DOWNLOADS, completeDays(withToday, "2026-08-25"), bounds),
    ).toBeNull();
  });
});
