import { describe, expect, it } from "vitest";

import {
  apostropheNote,
  delta,
  formatDay,
  formatPercent,
  formatRank,
  formatRating,
  formatRatingDelta,
  rankDelta,
  timeAgo,
} from "./format";

describe("formatPercent", () => {
  it("gives one decimal place", () => {
    expect(formatPercent(210, 800)).toBe("26.3%");
  });

  it("keeps movement visible in the low single digits", () => {
    // Impression to install rates live here, where rounding to a whole number
    // would hide a real week-on-week change.
    expect(formatPercent(212, 5000)).toBe("4.2%");
  });

  it("returns a dash rather than 0% when nothing arrived", () => {
    // A stage with an empty stage above it has no rate. Printing 0.0% would
    // read as "nobody converted" when the truth is "there was nothing to
    // convert yet", which is the opposite conclusion.
    expect(formatPercent(0, 0)).toBe("—");
    expect(formatPercent(5, 0)).toBe("—");
  });

  it("returns a dash for missing figures rather than NaN", () => {
    expect(formatPercent(null, 100)).toBe("—");
    expect(formatPercent(10, null)).toBe("—");
  });

  it("handles a rate of zero from a real denominator", () => {
    // Genuinely nobody installed, which is a fact worth printing.
    expect(formatPercent(0, 500)).toBe("0.0%");
  });
});

describe("rankDelta", () => {
  it("treats a falling rank number as an improvement", () => {
    // #24 to #21 is movement up the chart. Getting this backwards would show a
    // red down-arrow on the app's best week.
    const result = rankDelta(21, 24);

    expect(result.direction).toBe("up");
    expect(result.magnitude).toBe(3);
    expect(result.label).toContain("up");
  });

  it("treats a rising rank number as a decline", () => {
    expect(rankDelta(30, 21).direction).toBe("down");
  });

  it("distinguishes no history from no change", () => {
    expect(rankDelta(21, null).direction).toBe("unknown");
    expect(rankDelta(21, null).label).toBe("no history yet");
    expect(rankDelta(21, 21).direction).toBe("flat");
    expect(rankDelta(21, 21).label).toBe("no change");
  });

  it("names the span when the comparison is not a full week", () => {
    // Collection started four days ago. Showing this movement unqualified
    // would present four days as a week; the span is what makes it honest.
    expect(rankDelta(21, 24, 4).spanLabel).toBe("over 4 days");
  });

  it("stays silent about the span at exactly a week", () => {
    // A week is what the pages already claim in their own headings, so
    // repeating it on every figure is noise.
    expect(rankDelta(21, 24, 7).spanLabel).toBeNull();
    expect(rankDelta(21, 24).spanLabel).toBeNull();
  });

  it("says one day in the singular", () => {
    expect(rankDelta(21, 24, 1).spanLabel).toBe("over 1 day");
  });

  it("carries no span when there is nothing to compare", () => {
    expect(rankDelta(21, null, 4).spanLabel).toBeNull();
  });
});

describe("delta", () => {
  it("points up when a bigger number is better", () => {
    // The opposite polarity to rankDelta, which is the whole reason they are
    // separate functions.
    expect(delta(530577, 529100).direction).toBe("up");
  });

  it("distinguishes no history from no change", () => {
    expect(delta(10, null).label).toBe("no history yet");
    expect(delta(10, 10).label).toBe("no change");
  });

  it("names a short span the same way rankDelta does", () => {
    expect(delta(530577, 529100, 4).spanLabel).toBe("over 4 days");
    expect(delta(530577, 529100, 7).spanLabel).toBeNull();
  });
});

describe("formatRatingDelta", () => {
  it("ignores changes below the displayed precision", () => {
    // Ratings show two decimals. A 0.001 wobble is not a movement worth an arrow.
    expect(formatRatingDelta(4.6876, 4.6874).direction).toBe("flat");
  });

  it("reports a real change with a sign", () => {
    expect(formatRatingDelta(4.69, 4.62).label).toBe("+0.07");
  });

  it("carries a short span too", () => {
    expect(formatRatingDelta(4.69, 4.62, 3).spanLabel).toBe("over 3 days");
  });
});

describe("value formatting", () => {
  it("renders missing values as a dash, never as zero", () => {
    expect(formatRating(null)).toBe("—");
    expect(formatRank(null)).toBe("—");
  });

  it("prefixes ranks with a hash", () => {
    expect(formatRank(21)).toBe("#21");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-08-11T12:00:00Z");

  it("describes recent runs in minutes and hours", () => {
    expect(timeAgo("2026-08-11T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-08-11T06:00:00Z", now)).toBe("6h ago");
    expect(timeAgo("2026-08-08T12:00:00Z", now)).toBe("3d ago");
  });

  it("says never when a source has no run at all", () => {
    expect(timeAgo(null, now)).toBe("never");
  });
});

describe("formatDay", () => {
  it("renders a plain date without shifting it across time zones", () => {
    // A download figure is a whole day, not a moment. Local-time parsing of a
    // bare date can move it to the previous day west of UTC.
    expect(formatDay("2026-08-10")).toBe("10 Aug");
  });

  it("names the Tashkent day a moment fell on", () => {
    // 20:00 UTC is already the next morning in Tashkent. Labelling it "14
    // Aug" put chart ticks a day behind the buckets they marked, and made
    // two different days print the same date on the axis.
    expect(formatDay("2026-08-14T20:00:00Z")).toBe("15 Aug");
  });

  it("keeps a daytime moment on its own day", () => {
    expect(formatDay("2026-08-14T06:00:00Z")).toBe("14 Aug");
  });
});

describe("apostropheNote", () => {
  it("names the modifier apostrophe so two tracked forms are tellable apart", () => {
    // The keywords page lists ta'lim twice on purpose: Apple returns different
    // results for the two spellings and people type both. Rendered plainly the
    // rows look identical, so the page reads as having a duplication bug.
    expect(apostropheNote("taʼlim")).toBe("modifier ʼ");
    expect(apostropheNote("ta'lim")).toBeNull();
  });

  it("names the turned comma used in oʻzbek spellings", () => {
    expect(apostropheNote("oʻzbek")).toBe("turned comma ʻ");
  });

  it("says nothing about a keyword with no apostrophe at all", () => {
    expect(apostropheNote("matematika")).toBeNull();
  });
});
