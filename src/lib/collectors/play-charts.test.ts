/**
 * Where we sit in a Play chart.
 *
 * The arithmetic is small, but two of its cases are easy to get wrong in ways
 * that are invisible afterwards: an off-by-one turns #5 into #4 and nothing in
 * the UI looks broken, and confusing "outside the chart" with "the poll failed"
 * turns a real absence into a gap in the record. chart_ranks distinguishes the
 * two by storing null for the first and no row at all for the second, so the
 * distinction has to survive this function.
 */

import { describe, expect, it } from "vitest";

import { parsePlayChart, type PlayChartQuery } from "./play-charts";
import { ParseError } from "./types";

const query: PlayChartQuery = {
  country: "uz",
  collection: "TOP_FREE",
  category: "EDUCATION",
  genre: "EDUCATION",
  chartType: "topfree",
};

/** The real UZ Education top five, read from the store on 2026-08-24. */
const chart = [
  { appId: "uz.osonprava.app" },
  { appId: "com.duolingo" },
  { appId: "com.microblink.photomath" },
  { appId: "uz.ibrat.farzandlari" },
  { appId: "uz.uztozedu.ustozai" },
];

describe("parsePlayChart", () => {
  it("ranks from one, not from zero", () => {
    const result = parsePlayChart(chart, query);

    expect(result.rank).toBe(5);
    expect(result.feedSize).toBe(5);
  });

  it("marks the row as Android so it cannot be read as an App Store rank", () => {
    // saveChartRanks resolves app_id from this field. Get it wrong and the
    // rank lands on the iOS app, where it would interleave with Apple's.
    const result = parsePlayChart(chart, query);

    expect(result.platform).toBe("android");
    expect(result.storeId).toBe("uz.uztozedu.ustozai");
  });

  it("carries the query through to the stored row", () => {
    const result = parsePlayChart(chart, query);

    expect(result.country).toBe("uz");
    expect(result.chartType).toBe("topfree");
    expect(result.genre).toBe("EDUCATION");
  });

  it("reports null rather than zero when the app is outside the chart", () => {
    // null means "polled fine, we are not in it", which the charts render
    // differently from a gap left by a failed poll.
    const result = parsePlayChart([{ appId: "com.duolingo" }], query);

    expect(result.rank).toBeNull();
    expect(result.feedSize).toBe(1);
  });

  it("treats an empty chart as empty, not as broken", () => {
    const result = parsePlayChart([], query);

    expect(result.rank).toBeNull();
    expect(result.feedSize).toBe(0);
  });

  it("throws when the payload is not a chart at all", () => {
    // A shape change upstream must fail loudly. Coercing it to "outside the
    // chart" would quietly report the app as unranked forever.
    expect(() => parsePlayChart({ error: "quota" }, query)).toThrow(ParseError);
    expect(() => parsePlayChart(null, query)).toThrow(ParseError);
  });

  it("finds the app wherever it sits, including first", () => {
    expect(parsePlayChart([{ appId: "uz.uztozedu.ustozai" }], query).rank).toBe(1);
  });
});
