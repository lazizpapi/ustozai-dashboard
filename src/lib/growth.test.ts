import { describe, expect, it } from "vitest";

import {
  bucketOf,
  countByBucket,
  fillBuckets,
  localDate,
  netChangeByBucket,
  sumByBucket,
  toPeriod,
} from "./growth";

/**
 * The arithmetic that turns readings into growth, at its boundaries.
 *
 * Almost every bug this can have produces a plausible wrong number rather than
 * an error: a day shifted by a timezone, a loss clamped to zero, a running
 * total drawn as if it were a gain. So the cases below are chosen to be the
 * ones that would look fine on screen and be wrong.
 */

// Tashkent is UTC+5 and does not observe daylight saving.
describe("localDate", () => {
  it("uses the office timezone, not UTC", () => {
    // 20:00 UTC is already the next day in Tashkent. Bucketing on the UTC date
    // would file an evening's joins under the wrong day for everyone reading.
    expect(localDate("2026-08-12T20:00:00Z")).toBe("2026-08-13");
  });

  it("keeps a morning reading on its own day", () => {
    expect(localDate("2026-08-12T06:00:00Z")).toBe("2026-08-12");
  });

  it("puts the moment before local midnight on the earlier day", () => {
    expect(localDate("2026-08-12T18:59:00Z")).toBe("2026-08-12");
  });
});

describe("bucketOf", () => {
  it("passes a day through unchanged", () => {
    expect(bucketOf("2026-08-13", "day")).toBe("2026-08-13");
  });

  it("snaps a week back to its Monday", () => {
    expect(bucketOf("2026-08-13", "week")).toBe("2026-08-10"); // Thursday to Monday
    expect(bucketOf("2026-08-10", "week")).toBe("2026-08-10"); // Monday stays
  });

  it("treats Sunday as the end of its week, not the start", () => {
    // Sunday 16 Aug belongs to the week beginning Monday 10 Aug.
    expect(bucketOf("2026-08-16", "week")).toBe("2026-08-10");
    expect(bucketOf("2026-08-17", "week")).toBe("2026-08-17");
  });

  it("snaps months and years to their first day", () => {
    expect(bucketOf("2026-08-13", "month")).toBe("2026-08-01");
    expect(bucketOf("2026-08-13", "year")).toBe("2026-01-01");
  });
});

describe("netChangeByBucket", () => {
  const now = new Date("2026-08-14T06:00:00Z"); // 11:00 in Tashkent on the 14th

  it("differences consecutive buckets rather than reporting the total", () => {
    // The whole point: 50,300 followers is not a gain of 50,300.
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T09:00:00Z", value: 50_000 },
        { at: "2026-08-12T09:00:00Z", value: 50_120 },
        { at: "2026-08-13T09:00:00Z", value: 50_300 },
      ],
      "day",
      now,
    );

    expect(points.map((p) => p.value)).toEqual([120, 180]);
  });

  it("drops the first bucket, which has nothing to difference against", () => {
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T09:00:00Z", value: 50_000 },
        { at: "2026-08-12T09:00:00Z", value: 50_120 },
      ],
      "day",
      now,
    );

    expect(points).toHaveLength(1);
    expect(points[0].bucket).toBe("2026-08-12");
  });

  it("preserves a net loss instead of clamping it to zero", () => {
    // People leave channels. Telegram moved both directions inside two days,
    // and a chart that cannot draw this is lying by omission.
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T09:00:00Z", value: 50_384 },
        { at: "2026-08-12T09:00:00Z", value: 50_254 },
      ],
      "day",
      now,
    );

    expect(points[0].value).toBe(-130);
  });

  it("takes the last reading in a bucket, not the first", () => {
    // With hourly polling a day holds many readings. Closing on the last one
    // is what makes a missed poll harmless rather than lost.
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T06:00:00Z", value: 100 },
        { at: "2026-08-11T14:00:00Z", value: 130 },
        { at: "2026-08-12T06:00:00Z", value: 150 },
        { at: "2026-08-12T14:00:00Z", value: 210 },
      ],
      "day",
      now,
    );

    // The 11th closes at 130 and the 12th at 210, so the gain is 80. Reading
    // the first of each bucket instead would give 50, which is why the values
    // are chosen so the two answers cannot coincide.
    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(80);
  });

  it("files a late-evening UTC reading under the next local day", () => {
    // 20:00 UTC is already tomorrow in Tashkent. This is the case that would
    // silently misdate every evening's activity if bucketing used UTC.
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T06:00:00Z", value: 100 },
        { at: "2026-08-11T20:00:00Z", value: 175 },
      ],
      "day",
      now,
    );

    expect(points).toHaveLength(1);
    expect(points[0].bucket).toBe("2026-08-12");
  });

  it("carries a missed poll into the next bucket rather than losing it", () => {
    const points = netChangeByBucket(
      [
        { at: "2026-08-11T09:00:00Z", value: 100 },
        // Nothing recorded on the 12th at all.
        { at: "2026-08-13T09:00:00Z", value: 300 },
      ],
      "day",
      now,
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ bucket: "2026-08-13", value: 200 });
  });

  it("marks the bucket in progress, which is always understated", () => {
    const points = netChangeByBucket(
      [
        { at: "2026-08-12T09:00:00Z", value: 100 },
        { at: "2026-08-13T09:00:00Z", value: 200 },
        { at: "2026-08-14T05:00:00Z", value: 240 },
      ],
      "day",
      now,
    );

    expect(points.find((p) => p.bucket === "2026-08-13")?.isPartial).toBe(false);
    expect(points.find((p) => p.bucket === "2026-08-14")?.isPartial).toBe(true);
  });

  it("returns nothing for a single reading, since no change is known yet", () => {
    expect(netChangeByBucket([{ at: "2026-08-13T09:00:00Z", value: 5 }], "day", now)).toEqual([]);
    expect(netChangeByBucket([], "day", now)).toEqual([]);
  });

  it("groups many days into one bucket for a longer period", () => {
    const points = netChangeByBucket(
      [
        { at: "2026-08-07T09:00:00Z", value: 1000 }, // week of 3 Aug
        { at: "2026-08-11T09:00:00Z", value: 1200 }, // week of 10 Aug
        { at: "2026-08-13T09:00:00Z", value: 1500 }, // same week
      ],
      "week",
      now,
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ bucket: "2026-08-10", value: 500 });
  });
});

describe("sumByBucket and countByBucket", () => {
  const now = new Date("2026-08-14T06:00:00Z");

  it("adds events up rather than differencing them", () => {
    // Events already describe one period each. Differencing these would be the
    // classic wrong answer.
    const points = sumByBucket(
      [
        { at: "2026-08-12T09:00:00Z", amount: 40 },
        { at: "2026-08-12T20:00:00Z", amount: 10 }, // 13th in Tashkent
        { at: "2026-08-13T09:00:00Z", amount: 5 },
      ],
      "day",
      now,
    );

    expect(points.find((p) => p.bucket === "2026-08-12")?.value).toBe(40);
    expect(points.find((p) => p.bucket === "2026-08-13")?.value).toBe(15);
  });

  it("counts one per timestamp", () => {
    const points = countByBucket(
      ["2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z", "2026-08-13T09:00:00Z"],
      "day",
      now,
    );

    expect(points.map((p) => p.value)).toEqual([2, 1]);
  });

  it("zero-fills a quiet stretch instead of closing the gap", () => {
    // Dropping empty buckets would slide a busy day next to another busy day
    // and make a quiet week look active.
    const points = countByBucket(["2026-08-10T09:00:00Z", "2026-08-13T09:00:00Z"], "day", now);

    expect(points.map((p) => p.bucket)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
    ]);
    expect(points.map((p) => p.value)).toEqual([1, 0, 0, 1]);
  });

  it("keeps the first bucket, unlike a counter series", () => {
    expect(countByBucket(["2026-08-13T09:00:00Z"], "day", now)).toHaveLength(1);
  });

  it("returns nothing for no events", () => {
    expect(countByBucket([], "day", now)).toEqual([]);
  });
});

describe("fillBuckets", () => {
  it("walks days, weeks, months and years", () => {
    expect(fillBuckets("2026-08-10", "2026-08-12", "day")).toHaveLength(3);
    expect(fillBuckets("2026-08-03", "2026-08-17", "week")).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
    ]);
    expect(fillBuckets("2025-11-01", "2026-02-01", "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(fillBuckets("2025-01-01", "2026-01-01", "year")).toEqual(["2025-01-01", "2026-01-01"]);
  });

  it("handles a single-bucket range", () => {
    expect(fillBuckets("2026-08-10", "2026-08-10", "day")).toEqual(["2026-08-10"]);
  });
});

describe("toPeriod", () => {
  it("accepts the four real periods", () => {
    expect(toPeriod("week")).toBe("week");
    expect(toPeriod("year")).toBe("year");
  });

  it("falls back to day for anything else, rather than throwing on a URL", () => {
    expect(toPeriod(undefined)).toBe("day");
    expect(toPeriod("fortnight")).toBe("day");
    expect(toPeriod("../../etc")).toBe("day");
  });
});
