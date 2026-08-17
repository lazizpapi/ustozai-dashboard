import { describe, expect, it } from "vitest";

import { parseActiveUsersPayload, stickiness } from "./active-users";

/**
 * Validating active-user counts arriving from the app's own backend.
 *
 * This is the first figure on the dashboard that we do not measure ourselves,
 * which makes it the first one a bug in somebody else's cron job can quietly
 * corrupt. Everything here exists to make a malformed push loud rather than
 * stored.
 */

const day = {
  date: "2026-08-16",
  dau: 1200,
  wau: 5400,
  mau: 14000,
};

describe("parseActiveUsersPayload", () => {
  it("accepts one day and defaults the platform to all", () => {
    const result = parseActiveUsersPayload(day);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ ...day, platform: "all" }]);
  });

  it("accepts an array so history can be backfilled in one call", () => {
    const result = parseActiveUsersPayload([day, { ...day, date: "2026-08-15" }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it("accepts a per-platform breakdown", () => {
    const result = parseActiveUsersPayload({ ...day, platform: "ios" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].platform).toBe("ios");
  });

  it("rejects DAU above WAU", () => {
    // Nobody can be active today without being active this week. A backend
    // sending this has a bug, and storing it would put an impossible
    // stickiness ratio on the dashboard.
    const result = parseActiveUsersPayload({ ...day, dau: 9000, wau: 5400 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/dau/i);
  });

  it("rejects WAU above MAU", () => {
    const result = parseActiveUsersPayload({ ...day, wau: 20000, mau: 14000 });

    expect(result.ok).toBe(false);
  });

  it("allows the three to be equal", () => {
    // A brand-new app, or one launched today, legitimately has DAU = WAU = MAU.
    expect(parseActiveUsersPayload({ date: "2026-08-16", dau: 5, wau: 5, mau: 5 }).ok).toBe(
      true,
    );
  });

  it("rejects a malformed date rather than coercing it", () => {
    // "16/08/2026" parsed loosely becomes a different day, and a figure filed
    // under the wrong date is worse than one rejected.
    expect(parseActiveUsersPayload({ ...day, date: "16/08/2026" }).ok).toBe(false);
    expect(parseActiveUsersPayload({ ...day, date: "2026-8-6" }).ok).toBe(false);
    expect(parseActiveUsersPayload({ ...day, date: "not a date" }).ok).toBe(false);
  });

  it("rejects an impossible calendar date", () => {
    expect(parseActiveUsersPayload({ ...day, date: "2026-02-31" }).ok).toBe(false);
  });

  it("rejects negative and fractional counts", () => {
    expect(parseActiveUsersPayload({ ...day, dau: -1 }).ok).toBe(false);
    expect(parseActiveUsersPayload({ ...day, dau: 12.5 }).ok).toBe(false);
  });

  it("rejects counts sent as strings", () => {
    // A JSON body with "1200" instead of 1200 usually means the sender built
    // it by string concatenation, and the next field may be wrong too.
    expect(parseActiveUsersPayload({ ...day, dau: "1200" }).ok).toBe(false);
  });

  it("rejects a missing field rather than treating it as zero", () => {
    expect(parseActiveUsersPayload({ date: "2026-08-16", dau: 10, wau: 20 }).ok).toBe(false);
  });

  it("rejects an empty array, which is a sender bug rather than a no-op", () => {
    expect(parseActiveUsersPayload([]).ok).toBe(false);
  });

  it("rejects a future date", () => {
    // Tomorrow's actives cannot be known. This is usually a timezone bug in
    // the sender, and it would park a row ahead of every real reading.
    const result = parseActiveUsersPayload({ ...day, date: "2099-01-01" });
    expect(result.ok).toBe(false);
  });

  it("names the offending row when one of many fails", () => {
    // A 400 that does not say which of thirty backfilled days was wrong sends
    // the other developer hunting.
    const result = parseActiveUsersPayload([day, { ...day, date: "2026-08-15", dau: -5 }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("2026-08-15");
  });

  it("rejects nonsense bodies without throwing", () => {
    for (const body of [null, undefined, "hello", 42, true, {}]) {
      expect(parseActiveUsersPayload(body).ok).toBe(false);
    }
  });

  it("rejects a platform outside the known set", () => {
    expect(parseActiveUsersPayload({ ...day, platform: "windows-phone" }).ok).toBe(false);
  });
});

describe("stickiness", () => {
  it("is DAU over MAU as a percentage", () => {
    expect(stickiness(1200, 14000)).toBeCloseTo(8.571, 2);
  });

  it("returns null rather than zero when MAU is missing or zero", () => {
    // 0% stickiness reads as "nobody comes back", which is a claim. No
    // denominator is the absence of a claim.
    expect(stickiness(1200, 0)).toBeNull();
    expect(stickiness(1200, null)).toBeNull();
    expect(stickiness(null, 14000)).toBeNull();
  });
});
