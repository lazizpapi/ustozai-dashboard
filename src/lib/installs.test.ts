import { describe, expect, it } from "vitest";

import { latestInstallRate } from "./installs";

/**
 * Reading a daily install rate out of Google's batch counter.
 *
 * Google publishes a running total and updates it in batches, observed every
 * day or two rather than daily. Differencing that per day therefore produces a
 * spiky series like 0, 912, 0 where the 912 is really two days of installs and
 * the zeros are "the batch has not landed", not "nobody installed".
 *
 * Presenting any single element of that series as a daily figure is wrong in
 * one of two directions. These pin the reduction that makes it honest.
 */

const day = (date: string, installs: number) => ({ date, installs });

describe("latestInstallRate", () => {
  it("ignores a trailing zero, which means the batch has not landed yet", () => {
    // The reported case: on the 15th the counter had not moved all day, so the
    // card read 0 next to an App Store figure of 119.
    const rate = latestInstallRate([
      day("2026-08-13", 0),
      day("2026-08-14", 912),
      day("2026-08-15", 0),
    ]);

    expect(rate).not.toBeNull();
    expect(rate!.date).toBe("2026-08-14");
  });

  it("spreads a batch across the days it actually covers", () => {
    // 912 landed on the 14th but the counter also sat still on the 13th, so
    // the movement is two days of installs. Reporting 912 as one day would
    // overstate it by about double.
    const rate = latestInstallRate([
      day("2026-08-13", 0),
      day("2026-08-14", 912),
      day("2026-08-15", 0),
    ])!;

    expect(rate.installs).toBe(912);
    expect(rate.spanDays).toBe(2);
    expect(rate.perDay).toBe(456);
  });

  it("reports a genuine single day as one day", () => {
    const rate = latestInstallRate([day("2026-08-11", 300), day("2026-08-12", 424)])!;

    expect(rate.spanDays).toBe(1);
    expect(rate.perDay).toBe(424);
    expect(rate.date).toBe("2026-08-12");
  });

  it("handles several dormant days before a batch", () => {
    const rate = latestInstallRate([
      day("2026-08-10", 0),
      day("2026-08-11", 0),
      day("2026-08-12", 900),
    ])!;

    expect(rate.spanDays).toBe(3);
    expect(rate.perDay).toBe(300);
  });

  it("returns null when the counter has never moved", () => {
    // Nothing to report is different from zero installs, and the caller shows
    // a dash rather than a number it cannot stand behind.
    expect(latestInstallRate([day("2026-08-14", 0), day("2026-08-15", 0)])).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(latestInstallRate([])).toBeNull();
  });

  it("rounds to a whole install rather than a fraction of a person", () => {
    const rate = latestInstallRate([day("2026-08-13", 0), day("2026-08-14", 101)])!;
    expect(Number.isInteger(rate.perDay)).toBe(true);
  });
});
