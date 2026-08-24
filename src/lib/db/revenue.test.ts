/**
 * Tiyin to som.
 *
 * Payme and Click report takings in tiyin, the hundredth of a som, so every
 * figure on the business page is the API's number divided by a hundred. Worth
 * pinning down because both failure modes are quiet: forget the division and
 * the company looks a hundred times richer than it is, apply it twice and a
 * hundred times poorer, and neither reads as obviously wrong on a dashboard
 * where nobody remembers what the number was yesterday.
 */

import { describe, expect, it } from "vitest";

import { summariseRevenue, type RevenueRow } from "./queries";

const WEEK_AGO = "2026-08-15T00:00:00.000Z";

const row = (
  date: string,
  provider: string,
  amount: number,
  transactions = 1,
): RevenueRow => ({ date, provider, amount, transactions });

describe("summariseRevenue", () => {
  it("divides the day total by a hundred", () => {
    // The figures the business page was showing unconverted: 89,232,000 tiyin
    // read as som made a single day look like the takings of a whole quarter.
    const summary = summariseRevenue([row("2026-08-22", "ALL", 89_232_000, 11)], WEEK_AGO);

    expect(summary.latest).toEqual({
      date: "2026-08-22",
      amount: 892_320,
      transactions: 11,
    });
  });

  it("leaves the transaction count alone", () => {
    const summary = summariseRevenue([row("2026-08-22", "ALL", 89_232_000, 11)], WEEK_AGO);

    // Only the money is in tiyin. Scaling the count too would be a tempting
    // symmetry and would silently divide eleven payments into nought.
    expect(summary.latest?.transactions).toBe(11);
  });

  it("sums in tiyin and converts once, rather than converting every row", () => {
    // Both orderings are correct to the cent, but dividing first and adding
    // afterwards leaves a float tail at the magnitudes this account actually
    // trades in: these two rows come to 82619253.96000001 that way.
    const summary = summariseRevenue(
      [row("2026-08-21", "ALL", 5_272_956_892), row("2026-08-22", "ALL", 2_988_968_504)],
      WEEK_AGO,
    );

    expect(summary.windowTotal).toBe(82_619_253.96);
  });

  it("converts each provider and keeps the API's own day total out of them", () => {
    const summary = summariseRevenue(
      [
        row("2026-08-22", "ALL", 50_000, 4),
        row("2026-08-22", "PAYME", 30_000, 2),
        row("2026-08-22", "CLICK", 20_000, 2),
      ],
      WEEK_AGO,
    );

    expect(summary.byProvider).toEqual([
      { provider: "PAYME", amount: 300, transactions: 2 },
      { provider: "CLICK", amount: 200, transactions: 2 },
    ]);
    // The 'ALL' row is the API's own total, not a third provider.
    expect(summary.windowTotal).toBe(500);
  });

  it("accumulates a provider across days before converting it", () => {
    const summary = summariseRevenue(
      [
        row("2026-08-21", "PAYME", 5_272_956_892),
        row("2026-08-22", "PAYME", 2_988_968_504),
      ],
      WEEK_AGO,
    );

    expect(summary.byProvider[0].amount).toBe(82_619_253.96);
  });

  it("reports nothing rather than zero when there are no takings", () => {
    const summary = summariseRevenue([], WEEK_AGO);

    expect(summary.latest).toBeNull();
    expect(summary.daily).toEqual([]);
    expect(summary.byProvider).toEqual([]);
    expect(summary.previous).toBeNull();
    expect(summary.windowTotal).toBe(0);
  });
});
