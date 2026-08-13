/**
 * Token lifecycle arithmetic.
 *
 * Worth testing carefully because both failure modes are silent and one is
 * unrecoverable. Refresh too early and Meta refuses because the token is under
 * a day old. Refresh too late and the token is dead for good, needing a human
 * to sign in again. The window between those is what these tests pin down.
 */

import { describe, expect, it } from "vitest";

import {
  ESCALATE_WHEN_DAYS_LEFT,
  REFRESH_WHEN_DAYS_LEFT,
  daysUntilExpiry,
  shouldRefresh,
  type StoredToken,
} from "./tokens";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-12T12:00:00Z");

const token = (opts: { expiresInDays: number; refreshedDaysAgo: number }): StoredToken => ({
  provider: "instagram",
  accessToken: "IGQ-example",
  expiresAt: new Date(NOW + opts.expiresInDays * DAY).toISOString(),
  refreshedAt: new Date(NOW - opts.refreshedDaysAgo * DAY).toISOString(),
});

describe("daysUntilExpiry", () => {
  it("counts down toward the deadline", () => {
    expect(daysUntilExpiry(token({ expiresInDays: 60, refreshedDaysAgo: 0 }), NOW)).toBeCloseTo(60);
    expect(daysUntilExpiry(token({ expiresInDays: 3, refreshedDaysAgo: 57 }), NOW)).toBeCloseTo(3);
  });

  it("goes negative once the token is dead", () => {
    expect(daysUntilExpiry(token({ expiresInDays: -2, refreshedDaysAgo: 62 }), NOW)).toBeLessThan(0);
  });
});

describe("shouldRefresh", () => {
  it("does nothing on a freshly issued token", () => {
    // 60 days of life left. Refreshing now would burn a request for nothing.
    expect(shouldRefresh(token({ expiresInDays: 60, refreshedDaysAgo: 2 }), NOW)).toBe(false);
  });

  it("refreshes once inside the window", () => {
    const inside = REFRESH_WHEN_DAYS_LEFT - 1;
    expect(shouldRefresh(token({ expiresInDays: inside, refreshedDaysAgo: 31 }), NOW)).toBe(true);
  });

  it("will not refresh a token under a day old", () => {
    // Meta rejects these outright, so asking is a guaranteed failed step.
    expect(
      shouldRefresh(token({ expiresInDays: 5, refreshedDaysAgo: 0.5 }), NOW),
    ).toBe(false);
  });

  it("gives up on an already-expired token rather than trying forever", () => {
    // Past expiry there is nothing to exchange; only a human can fix it, and
    // retrying daily would just log a failure every morning.
    expect(shouldRefresh(token({ expiresInDays: -1, refreshedDaysAgo: 61 }), NOW)).toBe(false);
  });

  it("leaves real slack between refreshing and escalating", () => {
    // The gap is what lets the cron be broken for a fortnight without anyone
    // losing the credential.
    expect(REFRESH_WHEN_DAYS_LEFT).toBeGreaterThan(ESCALATE_WHEN_DAYS_LEFT);
    expect(REFRESH_WHEN_DAYS_LEFT - ESCALATE_WHEN_DAYS_LEFT).toBeGreaterThanOrEqual(14);
  });

  it("is still trying throughout the escalation window", () => {
    // Inside 14 days the daily run keeps attempting and starts shouting; it
    // must not quietly stop trying just because it is close to the deadline.
    expect(shouldRefresh(token({ expiresInDays: 10, refreshedDaysAgo: 50 }), NOW)).toBe(true);
    expect(shouldRefresh(token({ expiresInDays: 1, refreshedDaysAgo: 59 }), NOW)).toBe(true);
  });
});
