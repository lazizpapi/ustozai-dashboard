import { describe, expect, it } from "vitest";

import {
  parseActiveUsers,
  parseDailyViews,
  parseTransactions,
  parseVisitSummary,
} from "./parse";

/**
 * Turning UstozAI's admin API into rows.
 *
 * Every figure in these tests is invented. The repository is public, and the
 * real payloads carry the company's revenue.
 *
 * The shapes, however, are real: they were captured from the live API on
 * 2026-08-19, because the API document we were given lists endpoints without
 * a single response shape. A parser written from that document would not have
 * failed, it would have read the wrong key and stored null forever.
 */

describe("parseActiveUsers", () => {
  const payload = {
    dauStats: [
      { label: "2026-08-17", count: 3100 },
      { label: "2026-08-18", count: 3200 },
    ],
    mauStats: [
      { label: "Iyul", count: 8000 },
      { label: "Avgust", count: 8700 },
    ],
  };

  it("reads daily active users off their ISO labels", () => {
    const result = parseActiveUsers(payload, "2026-07-01", "2026-08-18");

    expect(result.dau).toEqual([
      { date: "2026-08-17", count: 3100 },
      { date: "2026-08-18", count: 3200 },
    ]);
  });

  it("resolves Uzbek month names against the range that was requested", () => {
    // The API labels months "Avgust" with no year, so the year can only come
    // from the window we asked for. Positional zipping alone would be wrong
    // the moment a month is missing, so the name is verified too.
    const result = parseActiveUsers(payload, "2026-07-01", "2026-08-18");

    expect(result.mau).toEqual([
      { month: "2026-07", label: "Iyul", count: 8000 },
      { month: "2026-08", label: "Avgust", count: 8700 },
    ]);
  });

  it("spans a year boundary without guessing", () => {
    const result = parseActiveUsers(
      { dauStats: [], mauStats: [{ label: "Yanvar", count: 5 }] },
      "2026-01-01",
      "2026-01-31",
    );

    expect(result.mau[0].month).toBe("2026-01");
  });

  it("keeps a month it cannot place as null rather than inventing one", () => {
    // An unknown label means the API changed language or added a month name
    // we do not know. Filing that under a guessed month would put one team's
    // figure on another month's row.
    const result = parseActiveUsers(
      { dauStats: [], mauStats: [{ label: "Августа", count: 5 }] },
      "2026-08-01",
      "2026-08-31",
    );

    expect(result.mau[0].month).toBeNull();
    expect(result.mau[0].label).toBe("Августа");
  });

  it("accepts an empty payload as no readings, not as zero", () => {
    const result = parseActiveUsers({ dauStats: [], mauStats: [] }, "2026-08-01", "2026-08-02");
    expect(result.dau).toEqual([]);
    expect(result.mau).toEqual([]);
  });

  it("throws on a payload that is not the documented shape", () => {
    // Storing nothing is recoverable; storing a wrong number is not.
    expect(() => parseActiveUsers(null, "2026-08-01", "2026-08-02")).toThrow();
    expect(() => parseActiveUsers({}, "2026-08-01", "2026-08-02")).toThrow();
    expect(() =>
      parseActiveUsers({ dauStats: "nope", mauStats: [] }, "2026-08-01", "2026-08-02"),
    ).toThrow();
  });

  it("merges a date the API reports twice", () => {
    // Observed live over a long range: four days came back twice, each as the
    // real figure plus a stray 1, for example 782 and 1 on 2026-07-13. They
    // read as disjoint buckets rather than a restatement, so they are summed.
    //
    // The rule that matters more is what this is not. Letting the last row
    // win would have stored 1 active user for a day with 782, and Postgres
    // refuses a batch holding the same key twice, so the whole backfill
    // failed until this was handled.
    const result = parseActiveUsers(
      {
        dauStats: [
          { label: "2026-07-13", count: 782 },
          { label: "2026-07-13", count: 1 },
        ],
        mauStats: [],
      },
      "2026-07-01",
      "2026-07-31",
    );

    expect(result.dau).toEqual([{ date: "2026-07-13", count: 783 }]);
  });

  it("merges a month the API reports twice", () => {
    const result = parseActiveUsers(
      {
        dauStats: [],
        mauStats: [
          { label: "Iyul", count: 8000 },
          { label: "Iyul", count: 5 },
        ],
      },
      "2026-07-01",
      "2026-07-31",
    );

    expect(result.mau).toEqual([{ month: "2026-07", label: "Iyul", count: 8005 }]);
  });

  it("returns days oldest first even when the API interleaves them", () => {
    const result = parseActiveUsers(
      {
        dauStats: [
          { label: "2026-07-14", count: 2 },
          { label: "2026-07-13", count: 1 },
        ],
        mauStats: [],
      },
      "2026-07-01",
      "2026-07-31",
    );

    expect(result.dau.map((point) => point.date)).toEqual(["2026-07-13", "2026-07-14"]);
  });

  it("drops a row with an unusable date rather than the whole response", () => {
    const result = parseActiveUsers(
      { dauStats: [{ label: "not-a-date", count: 5 }, { label: "2026-08-18", count: 9 }], mauStats: [] },
      "2026-08-01",
      "2026-08-18",
    );

    expect(result.dau).toEqual([{ date: "2026-08-18", count: 9 }]);
  });
});

describe("parseDailyViews", () => {
  it("reads the single-wrapped array of daily counts", () => {
    // This endpoint is wrapped once while general-stats is wrapped twice, and
    // it is view counts rather than the DAU its documentation claims.
    expect(
      parseDailyViews([
        { date: "2026-08-18", count: 75000 },
        { date: "2026-08-19", count: 44000 },
      ]),
    ).toEqual([
      { date: "2026-08-18", count: 75000 },
      { date: "2026-08-19", count: 44000 },
    ]);
  });

  it("returns nothing for an empty day list", () => {
    expect(parseDailyViews([])).toEqual([]);
  });

  it("throws when the payload is not an array", () => {
    expect(() => parseDailyViews({ date: "2026-08-18" })).toThrow();
    expect(() => parseDailyViews(null)).toThrow();
  });
});

describe("parseVisitSummary", () => {
  it("reads logins and average minutes", () => {
    expect(parseVisitSummary({ totalLogins: 1200, averageMinutes: 7.5 })).toEqual({
      totalLogins: 1200,
      averageMinutes: 7.5,
    });
  });

  it("keeps a missing field null rather than zero", () => {
    // Zero average minutes claims nobody stayed. Absent claims nothing.
    expect(parseVisitSummary({ totalLogins: 1200 })).toEqual({
      totalLogins: 1200,
      averageMinutes: null,
    });
  });

  it("throws on a non-object payload", () => {
    expect(() => parseVisitSummary(null)).toThrow();
    expect(() => parseVisitSummary([])).toThrow();
  });
});

describe("parseTransactions", () => {
  const payload = {
    "2026-08-18": {
      totalAmount: 500,
      totalCount: 4,
      PAYME: [{ amount: 300, count: 2 }],
      CLICK: [{ amount: 200, count: 2 }],
    },
  };

  it("flattens the date-keyed object into rows, day total included", () => {
    const rows = parseTransactions(payload);

    expect(rows).toEqual([
      { date: "2026-08-18", provider: "ALL", amount: 500, transactions: 4 },
      { date: "2026-08-18", provider: "PAYME", amount: 300, transactions: 2 },
      { date: "2026-08-18", provider: "CLICK", amount: 200, transactions: 2 },
    ]);
  });

  it("sums several entries under one provider", () => {
    // A provider arrives as an array, and a day with two settlement batches
    // has two entries that both belong to that provider.
    const rows = parseTransactions({
      "2026-08-18": {
        totalAmount: 500,
        totalCount: 4,
        PAYME: [
          { amount: 300, count: 2 },
          { amount: 200, count: 2 },
        ],
      },
    });

    expect(rows).toContainEqual({
      date: "2026-08-18",
      provider: "PAYME",
      amount: 500,
      transactions: 4,
    });
  });

  it("discovers providers rather than hard-coding PAYME and CLICK", () => {
    // A new payment provider must appear on its own, not vanish because the
    // parser only knew the two that existed when it was written.
    const rows = parseTransactions({
      "2026-08-18": { totalAmount: 100, totalCount: 1, UZUM: [{ amount: 100, count: 1 }] },
    });

    expect(rows.map((row) => row.provider)).toEqual(["ALL", "UZUM"]);
  });

  it("sorts by date so the newest day is last", () => {
    const rows = parseTransactions({
      "2026-08-19": { totalAmount: 1, totalCount: 1 },
      "2026-08-17": { totalAmount: 2, totalCount: 1 },
    });

    expect(rows.map((row) => row.date)).toEqual(["2026-08-17", "2026-08-19"]);
  });

  it("ignores a key that is not a date", () => {
    const rows = parseTransactions({
      meta: { totalAmount: 9, totalCount: 9 },
      "2026-08-18": { totalAmount: 1, totalCount: 1 },
    });

    expect(rows.every((row) => row.date === "2026-08-18")).toBe(true);
  });

  it("accepts an empty object as a quiet week", () => {
    expect(parseTransactions({})).toEqual([]);
  });

  it("throws on a non-object payload", () => {
    expect(() => parseTransactions(null)).toThrow();
    expect(() => parseTransactions([])).toThrow();
  });
});
