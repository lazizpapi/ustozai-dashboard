import { describe, expect, it } from "vitest";

import { pulsePlatforms } from "./run-pulse";
import { isDue, PULSE_MAX_AGE_MS } from "./freshen";
import { audienceIsLive } from "@/components/tv/live-dot";
import type { SocialConfig } from "@/lib/env";
import type { SocialTrend } from "@/lib/db/queries";

/**
 * The fast lane's judgement calls, tested where they are decidable: which
 * platforms are worth a one-minute cadence, and when a stored reading is old
 * enough to justify going back out to the network.
 */

const ALL_CONFIGURED: SocialConfig = {
  telegram: { channel: "ustozai", botToken: "token" },
  instagram: { handle: "ustozai" },
  youtube: { handle: "UstozAI", apiKey: null },
};

describe("pulsePlatforms", () => {
  it("always includes Telegram, which is exact, live and cheap", () => {
    expect(pulsePlatforms(ALL_CONFIGURED, false)).toContain("telegram");
  });

  it("never includes YouTube, whose count is rounded to three significant figures", () => {
    // Not a rate limit concern: at 174K the value cannot change until the
    // channel crosses 174,500, so every extra read returns the same string.
    expect(pulsePlatforms(ALL_CONFIGURED, true)).not.toContain("youtube");
  });

  it("excludes Instagram until a token exists, because the fallback is a scrape", () => {
    // Instagram refuses datacenter addresses. Polling the scrape sixty times
    // more often would harden an intermittent block into a permanent one.
    expect(pulsePlatforms(ALL_CONFIGURED, false)).not.toContain("instagram");
  });

  it("includes Instagram once a token exists, since the API authenticates as the account", () => {
    expect(pulsePlatforms(ALL_CONFIGURED, true)).toEqual(["telegram", "instagram"]);
  });

  it("returns nothing when no account is configured", () => {
    const none: SocialConfig = { telegram: null, instagram: null, youtube: null };
    expect(pulsePlatforms(none, true)).toEqual([]);
  });
});

describe("isDue", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  it("is due when nothing has ever been read", () => {
    expect(isDue(null, now)).toBe(true);
  });

  it("is not due for a reading inside the window", () => {
    const recent = new Date(now - 10_000).toISOString();
    expect(isDue(recent, now)).toBe(false);
  });

  it("is due once the window has elapsed", () => {
    const old = new Date(now - PULSE_MAX_AGE_MS - 1).toISOString();
    expect(isDue(old, now)).toBe(true);
  });

  it("is due exactly at the boundary rather than one tick later", () => {
    expect(isDue(new Date(now - PULSE_MAX_AGE_MS).toISOString(), now)).toBe(true);
  });

  it("treats an unparseable timestamp as no reading, not as fresh", () => {
    // Failing this the wrong way costs a stale screen forever; failing it this
    // way costs one redundant request.
    expect(isDue("not a date", now)).toBe(true);
  });

  it("does not fetch on a clock skew that puts the reading in the future", () => {
    expect(isDue(new Date(now + 60_000).toISOString(), now)).toBe(false);
  });
});

describe("audienceIsLive", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  const trend = (checkedAt: string | null): SocialTrend => ({
    platform: "telegram",
    handle: "ustozai",
    isExact: true,
    checkedAt,
    isStale: false,
    current: 50_339,
    previous: null,
    capturedAt: "2026-08-13T12:00:00.000Z",
    noHistory: true,
  });

  it("is live just after a read", () => {
    expect(audienceIsLive([trend(new Date(now - 30_000).toISOString())], now)).toBe(true);
  });

  it("survives one missed refresh", () => {
    expect(audienceIsLive([trend(new Date(now - 90_000).toISOString())], now)).toBe(true);
  });

  it("is not live once the readings stop advancing", () => {
    expect(audienceIsLive([trend(new Date(now - 20 * 60_000).toISOString())], now)).toBe(false);
  });

  it("is not live with no readings at all", () => {
    expect(audienceIsLive([trend(null)], now)).toBe(false);
    expect(audienceIsLive([], now)).toBe(false);
  });

  it("stays live when only the slow-lane platforms are old", () => {
    // YouTube is deliberately left on the three-hourly poll, so its age must
    // not make the panel claim the whole section has stopped updating.
    const youtube: SocialTrend = {
      ...trend(new Date(now - 3 * 60 * 60_000).toISOString()),
      platform: "youtube",
    };
    expect(audienceIsLive([youtube, trend(new Date(now - 20_000).toISOString())], now)).toBe(true);
  });
});
