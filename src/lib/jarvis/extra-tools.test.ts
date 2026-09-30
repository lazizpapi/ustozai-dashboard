import { describe, expect, it, vi } from "vitest";

import { toolNames } from "@/lib/analyst/tools";

import {
  JARVIS_EXTRA_TOOLS,
  clampJarvisArgs,
  dailyRanks,
  jarvisToolNames,
  runExtraTool,
  type ExtraDeps,
} from "./extra-tools";

const EXTRA = [
  "get_rank_history",
  "get_rating_history",
  "get_installs_today",
  "get_releases",
  "get_ios_proceeds",
];

describe("the tools Jarvis has beyond the analyst's", () => {
  it("adds five tools after the analyst's own, and names none twice", () => {
    const names = jarvisToolNames();
    expect(names).toEqual([...toolNames(), ...EXTRA]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps them out of the analyst's list, which the unattended 6 am report runs with", () => {
    for (const name of EXTRA) expect(toolNames()).not.toContain(name);
  });

  it("declares every one for Gemini: a description and an object schema", () => {
    for (const tool of JARVIS_EXTRA_TOOLS) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.parameters).toMatchObject({ type: "object" });
    }
  });
});

describe("clampJarvisArgs", () => {
  it("keeps rank history to one store and at most ninety days", () => {
    expect(clampJarvisArgs("get_rank_history", { days: 500, platform: "web" })).toEqual({
      days: 90,
      platform: "ios",
    });
    expect(clampJarvisArgs("get_rank_history", { days: 14, platform: "android" })).toEqual({
      days: 14,
      platform: "android",
    });
    expect(clampJarvisArgs("get_rank_history", {})).toEqual({ days: 30, platform: "ios" });
  });

  it("bounds the windows of releases and proceeds", () => {
    expect(clampJarvisArgs("get_releases", {})).toEqual({ days: 90 });
    expect(clampJarvisArgs("get_releases", { days: 1000 })).toEqual({ days: 180 });
    expect(clampJarvisArgs("get_ios_proceeds", {})).toEqual({ days: 30 });
  });

  it("takes no arguments where none mean anything", () => {
    expect(clampJarvisArgs("get_rating_history", { x: 1 })).toEqual({});
    expect(clampJarvisArgs("get_installs_today", { x: 1 })).toEqual({});
  });

  it("leaves the analyst's tools to the analyst's own clamp", () => {
    expect(clampJarvisArgs("get_downloads", { days: 7 })).toEqual({ days: 7 });
  });
});

describe("dailyRanks", () => {
  it("keeps the last reading of each Tashkent day, even when it is off the chart", () => {
    const points = [
      { capturedAt: "2026-09-28T05:00:00Z", rank: 14, feedSize: 200 },
      { capturedAt: "2026-09-28T18:00:00Z", rank: 12, feedSize: 200 },
      // 00:30 on 29 September in Tashkent, though still the 28th in UTC.
      { capturedAt: "2026-09-28T19:30:00Z", rank: 11, feedSize: 200 },
      { capturedAt: "2026-09-29T10:00:00Z", rank: null, feedSize: 200 },
    ];
    expect(dailyRanks(points)).toEqual([
      { date: "2026-09-28", rank: 12 },
      { date: "2026-09-29", rank: null },
    ]);
  });
});

function deps(): ExtraDeps {
  const trend = { current: 11, previous: 13, capturedAt: "x", noHistory: false };
  return {
    rankHistory: vi.fn(async () => [{ capturedAt: "2026-09-28T05:00:00Z", rank: 14, feedSize: 200 }]),
    rankTrend: vi.fn(async () => ({ ...trend, feedSize: 200 })),
    ratingTrend: vi.fn(async (platform) => ({ ...trend, current: platform === "ios" ? 4.8 : 4.6, ratingCount: 10 })),
    androidInstallsSoFarToday: vi.fn(async () => null),
    iosProceeds: vi.fn(async () => []),
    ownReleases: vi.fn(async () => [{ date: "2026-09-20", platform: "ios" as const, version: "2.3" }]),
    reviewsByVersion: vi.fn(async () => []),
  } as unknown as ExtraDeps;
}

describe("runExtraTool", () => {
  it("reads the Education top free chart in Uzbekistan under each store's own genre", async () => {
    // Apple files Education as genre 6017; Google Play as "EDUCATION".
    const d = deps();
    const answer = await runExtraTool("get_rank_history", { days: 14, platform: "android" }, d);
    expect(d.rankHistory).toHaveBeenCalledWith("topfree", "uz", "EDUCATION", 14, "android");
    expect(d.rankTrend).toHaveBeenCalledWith("topfree", "uz", "EDUCATION", "android");
    await runExtraTool("get_rank_history", { days: 14, platform: "ios" }, d);
    expect(d.rankHistory).toHaveBeenLastCalledWith("topfree", "uz", "6017", 14, "ios");
    expect(answer).toMatchObject({ platform: "android", daily: [{ date: "2026-09-28", rank: 14 }] });
  });

  it("says when there were no chart readings, so it is not heard as off the chart", async () => {
    const d = deps();
    d.rankHistory = vi.fn(async () => []);
    const answer = (await runExtraTool("get_rank_history", { days: 7, platform: "ios" }, d)) as Record<
      string,
      unknown
    >;
    expect(answer.daily).toEqual([]);
    expect(String(answer.note)).toMatch(/no chart readings/i);
  });

  it("gives both stores' ratings", async () => {
    const answer = await runExtraTool("get_rating_history", {}, deps());
    expect(answer).toMatchObject({ ios: { current: 4.8 }, android: { current: 4.6 } });
  });

  it("says plainly when there is no reading for today yet, instead of zero", async () => {
    const answer = (await runExtraTool("get_installs_today", {}, deps())) as Record<string, unknown>;
    expect(answer.installs).toBeNull();
    expect(String(answer.note)).toMatch(/not zero/i);
  });

  it("warns that Play's counter moves about once a day, so a low count may be stale", async () => {
    const d = deps();
    d.androidInstallsSoFarToday = vi.fn(async () => ({ installs: 0, since: "2026-09-30T00:00:00Z" }));
    const answer = (await runExtraTool("get_installs_today", {}, d)) as Record<string, unknown>;
    expect(answer.installs).toBe(0);
    expect(String(answer.note)).toMatch(/about once a day/);
  });

  it("pairs our releases with how each version is rated", async () => {
    const answer = await runExtraTool("get_releases", { days: 90 }, deps());
    expect(answer).toMatchObject({ releases: [{ version: "2.3" }], versions: [] });
  });

  it("names each version once, on the day it was first seen, when a listing flip-flops", async () => {
    // Seen on 24 September 2026: the App Store listing swung between 2.3.0 and
    // 2.2.9 several times in one day, which reads back as five releases.
    const d = deps();
    d.now = () => new Date("2026-09-30T08:00:00Z");
    d.ownReleases = vi.fn(async () => [
      { date: "2026-09-14", platform: "ios" as const, version: "2.2.9" },
      { date: "2026-09-24", platform: "ios" as const, version: "2.3.0" },
      { date: "2026-09-24", platform: "ios" as const, version: "2.2.9" },
      { date: "2026-09-24", platform: "ios" as const, version: "2.3.0" },
      { date: "2026-09-25", platform: "android" as const, version: "2.3.0" },
    ]);
    const answer = (await runExtraTool("get_releases", { days: 30 }, d)) as { releases: unknown[] };
    expect(answer.releases).toEqual([
      { date: "2026-09-14", platform: "ios", version: "2.2.9" },
      { date: "2026-09-24", platform: "ios", version: "2.3.0" },
      { date: "2026-09-25", platform: "android", version: "2.3.0" },
    ]);
  });

  it("finds a release early in a short window instead of taking it as the baseline", async () => {
    // ownReleases treats the first listing it reads as the starting point, not
    // a release, so the window it reads must reach well before the one asked.
    const d = deps();
    d.now = () => new Date("2026-09-30T08:00:00Z");
    d.ownReleases = vi.fn(async () => [
      { date: "2026-08-16", platform: "android" as const, version: "2.2.8" },
      { date: "2026-09-27", platform: "ios" as const, version: "2.3.0" },
    ]);
    const answer = (await runExtraTool("get_releases", { days: 7 }, d)) as { releases: unknown[] };
    expect(d.ownReleases).toHaveBeenCalledWith(365);
    expect(answer.releases).toEqual([{ date: "2026-09-27", platform: "ios", version: "2.3.0" }]);
  });

  it("explains an empty proceeds list rather than reporting no money", async () => {
    const answer = (await runExtraTool("get_ios_proceeds", { days: 30 }, deps())) as Record<string, unknown>;
    expect(answer.proceeds).toEqual([]);
    expect(String(answer.note)).toMatch(/Payme/);
  });
});
