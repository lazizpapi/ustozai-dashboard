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
  "get_analyst_runs",
  "get_comment_activity",
];

describe("the tools Jarvis has beyond the analyst's", () => {
  it("adds seven tools after the analyst's own, and names none twice", () => {
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
    analystRunStatuses: vi.fn(async () => []),
    commentActivity: vi.fn(async () => null),
  } as unknown as ExtraDeps;
}

const NO_CREDITS = "429 You have no credits remaining. Add credits to continue using the API.";
const analystRun = (day: string, status: "ok" | "failed" | "stale-data", error: string | null = null) => ({
  createdAt: `${day}T01:40:07.000Z`,
  status,
  error,
});

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

describe("the analyst's run history", () => {
  it("lists recent runs by day, says why each failed, and how long the report has been out", async () => {
    const d = deps();
    d.analystRunStatuses = vi.fn(async () => [
      analystRun("2026-10-15", "failed", NO_CREDITS),
      analystRun("2026-10-14", "failed", NO_CREDITS),
      analystRun("2026-10-13", "stale-data", "collectors failing: play"),
      analystRun("2026-10-12", "ok"),
    ]);
    const answer = await runExtraTool("get_analyst_runs", {}, d);
    expect(answer).toEqual({
      runs: [
        { day: "2026-10-15", outcome: "failed", reason: "the OpenAI account has run out of credits" },
        { day: "2026-10-14", outcome: "failed", reason: "the OpenAI account has run out of credits" },
        {
          day: "2026-10-13",
          outcome: "refused",
          reason: "data collectors were failing (play), so it refused to write from bad numbers",
        },
        { day: "2026-10-12", outcome: "written" },
      ],
      outage: {
        failedDays: 3,
        since: "2026-10-13",
        lastWritten: "2026-10-12",
        reason: "the OpenAI account has run out of credits",
      },
    });
  });

  it("lists two weeks of runs at most, though it reads further back to count the outage", async () => {
    const d = deps();
    const failing = Array.from({ length: 30 }, (_, i) =>
      analystRun(new Date(Date.UTC(2026, 9, 30 - i)).toISOString().slice(0, 10), "failed", NO_CREDITS),
    );
    d.analystRunStatuses = vi.fn(async () => failing);
    const answer = (await runExtraTool("get_analyst_runs", {}, d)) as {
      runs: unknown[];
      outage: { failedDays: number };
    };
    expect(answer.runs).toHaveLength(14);
    expect(answer.outage.failedDays).toBe(30);
  });
});

describe("the comment bot", () => {
  const activity = {
    health: { lastPolledAt: "2026-10-15T04:50:00Z", minutesSincePoll: 10, alive: true },
    counts: { replied24h: 6, flagged24h: 1, skipped24h: 3 },
    recent: Array.from({ length: 25 }, (_, i) => ({
      commentId: `c${i}`,
      at: "2026-10-15T04:00:00Z",
      category: "reply",
      author: "Aziza",
      comment: "x".repeat(800),
      reply: "Rahmat!",
      reason: null,
      posted: true,
      videoId: "v1",
    })),
  };

  it("gives the bot's health, its last day's counts and its newest comments, cut short", async () => {
    const d = deps();
    d.commentActivity = vi.fn(async () => activity);
    const answer = (await runExtraTool("get_comment_activity", {}, d)) as {
      health: unknown;
      counts: unknown;
      recent: { comment: string; commentId?: string }[];
      note: string;
    };
    expect(answer.health).toEqual(activity.health);
    expect(answer.counts).toEqual(activity.counts);
    expect(answer.recent).toHaveLength(15);
    expect(answer.recent[0].comment).toHaveLength(300);
    expect(answer.recent[0]).not.toHaveProperty("commentId");
    // Comments come from the public: data to report, never instructions. The
    // note comes first, so a result cut short for Jarvis still carries it.
    expect(answer.note).toMatch(/written by the public/i);
    expect(Object.keys(answer)[0]).toBe("note");
  });

  it("says when the bot has stopped answering comments, so a quiet day is not heard as calm", async () => {
    const d = deps();
    d.commentActivity = vi.fn(async () => ({
      ...activity,
      health: { lastPolledAt: "2026-10-14T04:00:00Z", minutesSincePoll: 1500, alive: false },
    }));
    const answer = (await runExtraTool("get_comment_activity", {}, d)) as { note: string };
    expect(answer.note).toMatch(/has stopped/i);
  });

  it("says plainly when the bot is not connected to the dashboard", async () => {
    expect(await runExtraTool("get_comment_activity", {}, deps())).toEqual({
      available: false,
      note: "The comment bot is not connected to the dashboard, so there is nothing to report.",
    });
  });
});
