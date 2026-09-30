import { describe, expect, it } from "vitest";

import { FREE_MINUTES, billedMinutes, budgetNotice, monthStart, monthUsage } from "./budget";

/**
 * LiveKit's free plan gives the agent 1,000 minutes a month as a hard cap:
 * once they are spent every call fails until the 1st. The dashboard counts
 * them from the call log so it can warn early and refuse politely.
 */

describe("the month's minutes", () => {
  it("counts each call's started minute, as the plan bills whole minutes", () => {
    expect(billedMinutes([30, 61, 600])).toBe(1 + 2 + 10);
    expect(billedMinutes([])).toBe(0);
  });

  it("is plenty, then low, then spent", () => {
    expect(monthUsage(100)).toEqual({ used: 100, left: 900, low: false, spent: false });
    expect(monthUsage(800)).toEqual({ used: 800, left: 200, low: true, spent: false });
    expect(monthUsage(FREE_MINUTES)).toEqual({ used: 1000, left: 0, low: true, spent: true });
    expect(monthUsage(1200).left).toBe(0);
  });

  it("starts on the 1st of the month in UTC, when LiveKit's allowance resets", () => {
    expect(monthStart(new Date("2026-10-01T03:00:00+05:00")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(monthStart(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
});

describe("the line the call screen shows", () => {
  it("says nothing while minutes are plentiful", () => {
    expect(budgetNotice(monthUsage(100))).toBeNull();
  });

  it("says how many are left when they run low, and when they return once spent", () => {
    expect(budgetNotice(monthUsage(850))).toBe("About 150 minutes of calls left this month.");
    expect(budgetNotice(monthUsage(1000))).toMatch(/used up.*1st/);
  });
});
