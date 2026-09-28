/**
 * Headline figures describe a finished day.
 *
 * The admin API is polled hourly and answers for today as well, so the newest
 * stored row is always a day still being counted. Shown as the headline, it
 * read 5,440 daily actives at five in the afternoon against 7,801 for the whole
 * of the same weekday before, a 30% fall that never happened. At six in the
 * morning it read a few hundred.
 *
 * The alert rules already refused today for the same reason. These pin the same
 * rule onto the tiles.
 */

import { describe, expect, it } from "vitest";

import {
  summariseActiveUsers,
  summariseEngagement,
  summariseRevenue,
  type ActiveUserRow,
  type EngagementRow,
  type RevenueRow,
} from "./queries";

const TODAY = "2026-09-28";

const active = (date: string, dau: number, receivedAt = "2026-09-28T12:00:20Z"): ActiveUserRow => ({
  date,
  dau,
  wau: dau,
  mau: dau,
  received_at: receivedAt,
});

// The live figures from 28 September, newest first as the query returns them.
const ACTIVE_ROWS = [
  active("2026-09-28", 5440),
  active("2026-09-27", 5669),
  active("2026-09-26", 5774),
  active("2026-09-25", 6729),
  active("2026-09-24", 6744),
  active("2026-09-23", 8882),
  active("2026-09-22", 9761),
  active("2026-09-21", 7801),
  active("2026-09-20", 5601, "2026-09-27T18:00:15Z"),
];

describe("summariseActiveUsers", () => {
  it("heads with yesterday, not the day still being counted", () => {
    const summary = summariseActiveUsers(ACTIVE_ROWS, TODAY)!;

    expect(summary.date).toBe("2026-09-27");
    expect(summary.dau).toBe(5669);
  });

  it("keeps today's running count, under its own name", () => {
    expect(summariseActiveUsers(ACTIVE_ROWS, TODAY)!.todaySoFar).toBe(5440);
  });

  it("has no running count before the first poll of the day", () => {
    const summary = summariseActiveUsers(ACTIVE_ROWS.slice(1), TODAY)!;

    expect(summary.todaySoFar).toBeNull();
    expect(summary.dau).toBe(5669);
  });

  it("compares with the same weekday a week earlier", () => {
    const summary = summariseActiveUsers(ACTIVE_ROWS, TODAY)!;

    expect(summary.dauPrevious).toBe(5601);
    expect(summary.dauSpanDays).toBe(7);
  });

  it("is one day behind when collection is healthy", () => {
    expect(summariseActiveUsers(ACTIVE_ROWS, TODAY)!.daysBehind).toBe(1);
  });

  it("counts the days since the last finished one when collection stops", () => {
    const summary = summariseActiveUsers(ACTIVE_ROWS.slice(4), TODAY)!;

    expect(summary.date).toBe("2026-09-24");
    expect(summary.daysBehind).toBe(4);
  });

  it("reports nothing when no day has finished yet", () => {
    expect(summariseActiveUsers([active(TODAY, 5440)], TODAY)).toBeNull();
    expect(summariseActiveUsers([], TODAY)).toBeNull();
  });
});

const revenue = (date: string, amount: number): RevenueRow => ({
  date,
  provider: "ALL",
  amount,
  transactions: 1,
});

describe("summariseRevenue, on a day still being counted", () => {
  const rows = [
    revenue("2026-09-20", 10_000_000),
    revenue("2026-09-26", 15_600_000),
    revenue("2026-09-27", 44_330_000),
    revenue("2026-09-28", 3_900_000),
  ];

  it("heads with yesterday's takings", () => {
    expect(summariseRevenue(rows, TODAY).latest).toEqual({
      date: "2026-09-27",
      amount: 443_300,
      transactions: 1,
    });
  });

  it("compares with the same weekday a week earlier", () => {
    const summary = summariseRevenue(rows, TODAY);

    expect(summary.previous).toBe(100_000);
    expect(summary.spanDays).toBe(7);
  });

  it("still charts and totals today, which is money already taken", () => {
    const summary = summariseRevenue(rows, TODAY);

    expect(summary.daily.at(-1)?.date).toBe(TODAY);
    expect(summary.windowTotal).toBe(738_300);
  });
});

const engagement = (
  date: string,
  views: number | null,
  minutes: number | null = null,
  logins: number | null = null,
): EngagementRow => ({ date, views, total_logins: logins, average_minutes: minutes });

describe("summariseEngagement", () => {
  // Oldest first, as the query returns them. Session length lands on whichever
  // day was today when the poll ran, so only the newest days carry one.
  const rows = [
    engagement("2026-09-20", 24_000),
    engagement("2026-09-26", 25_558),
    engagement("2026-09-27", 26_557, 21.4, 3_100),
    engagement("2026-09-28", 21_925, 18.2, 1_900),
  ];

  it("heads with yesterday's views", () => {
    const summary = summariseEngagement(rows, TODAY)!;

    expect(summary.date).toBe("2026-09-27");
    expect(summary.views).toBe(26_557);
  });

  it("compares views with the same weekday a week earlier", () => {
    const summary = summariseEngagement(rows, TODAY)!;

    expect(summary.viewsPrevious).toBe(24_000);
    expect(summary.viewsSpanDays).toBe(7);
  });

  it("takes session length from a finished day too", () => {
    const summary = summariseEngagement(rows, TODAY)!;

    expect(summary.averageMinutes).toBe(21.4);
    expect(summary.totalLogins).toBe(3_100);
  });

  it("still charts today", () => {
    expect(summariseEngagement(rows, TODAY)!.daily.at(-1)?.date).toBe(TODAY);
  });

  it("reads the minutes column as a number, since Postgres numeric arrives as text", () => {
    const summary = summariseEngagement(
      [{ date: "2026-09-27", views: 1, total_logins: 2, average_minutes: "21.40" }],
      TODAY,
    )!;

    expect(summary.averageMinutes).toBe(21.4);
  });

  it("reports nothing when no day has finished yet", () => {
    expect(summariseEngagement([engagement(TODAY, 21_925)], TODAY)).toBeNull();
  });
});
