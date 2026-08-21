import { describe, expect, it } from "vitest";

import {
  DEFAULT_ATTEMPTS,
  DEFAULT_EMPTY_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  emptyBackoffMs,
  httpBackoffMs,
  worstCaseEmptyRetryMs,
  worstCaseFetchMs,
} from "./http";

/**
 * The retry budgets are the thing that broke, so they are the thing pinned.
 *
 * Nobody had multiplied the nested budgets out: three empty-feed attempts each
 * wrapping three HTTP attempts of fifteen seconds is over two minutes, and the
 * pulse that called it has thirty seconds. Neither number is wrong on its own,
 * which is exactly why the product went unnoticed.
 *
 * These helpers exist so that arithmetic is a value the tests can assert on
 * rather than a property of the running code that only production reveals.
 */

describe("httpBackoffMs", () => {
  it("doubles from half a second", () => {
    expect(httpBackoffMs(1)).toBe(500);
    expect(httpBackoffMs(2)).toBe(1000);
    expect(httpBackoffMs(3)).toBe(2000);
  });
});

describe("emptyBackoffMs", () => {
  it("grows linearly from three quarters of a second", () => {
    expect(emptyBackoffMs(1)).toBe(750);
    expect(emptyBackoffMs(2)).toBe(1500);
  });
});

describe("worstCaseFetchMs", () => {
  it("counts every attempt's timeout plus the gaps between them", () => {
    // 2 x 4000 waiting, and one 500ms backoff in the single gap.
    expect(worstCaseFetchMs({ attempts: 2, timeoutMs: 4_000 })).toBe(8_500);
  });

  it("has no backoff to add for a single attempt", () => {
    expect(worstCaseFetchMs({ attempts: 1, timeoutMs: 4_000 })).toBe(4_000);
  });

  it("falls back to the shared defaults", () => {
    expect(worstCaseFetchMs()).toBe(
      DEFAULT_ATTEMPTS * DEFAULT_TIMEOUT_MS + 500 + 1000,
    );
  });
});

describe("worstCaseEmptyRetryMs", () => {
  it("multiplies the HTTP budget by the empty-feed attempts and adds their gaps", () => {
    // 2 x 8500 for the fetches, plus one 750ms gap between the two attempts.
    expect(
      worstCaseEmptyRetryMs({ attempts: 2, timeoutMs: 4_000, emptyAttempts: 2 }),
    ).toBe(17_750);
  });

  it("collapses to a plain fetch when nothing is retried on empty", () => {
    expect(
      worstCaseEmptyRetryMs({ attempts: 2, timeoutMs: 4_000, emptyAttempts: 1 }),
    ).toBe(8_500);
  });

  /**
   * The regression, stated as a number.
   *
   * This is what the pulse was calling before it was given its own budget, and
   * it is recorded here so the next person to reach for a larger retry count
   * can see what the defaults already cost.
   */
  it("costs over two minutes at the shared defaults", () => {
    expect(worstCaseEmptyRetryMs()).toBe(141_750);
    expect(DEFAULT_EMPTY_ATTEMPTS).toBe(3);
  });
});
