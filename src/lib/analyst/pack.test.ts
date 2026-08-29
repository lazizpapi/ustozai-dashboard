import { describe, expect, it } from "vitest";

import { PACK_MAX_BYTES, buildPack, pipelineBroken, type PackInput } from "./pack";

/**
 * The briefing handed to the analyst.
 *
 * The pack is the agent's entire world: anything absent from it cannot be
 * reasoned about, and anything wrong in it becomes a confident wrong claim in
 * the report. So the properties pinned here are the ones that decide whether
 * the report can be trusted — size, staleness, and never inventing a number.
 */

function input(overrides: Partial<PackInput> = {}): PackInput {
  return {
    generatedAt: "2026-08-15T01:40:00.000Z",
    iosDownloads: [
      { date: "2026-08-10", downloads: 40 },
      { date: "2026-08-11", downloads: 45 },
    ],
    androidInstalls: [{ date: "2026-08-11", installs: 400 }],
    funnel: null,
    market: [],
    keywords: [],
    newSuggestions: [],
    listingChanges: [],
    reviews: { total: 12, averageRating: 4.6, worst: [] },
    audience: [],
    health: [],
    teamFacts: [],
    previousRecommendations: null,
    ...overrides,
  };
}

describe("buildPack", () => {
  it("keeps the briefing inside the size cap", () => {
    // The cap is the whole reason the pack exists rather than handing over raw
    // rows: a briefing that grows without bound eventually costs more than the
    // analysis is worth, and truncation mid-JSON would be worse than trimming.
    const huge = input({
      iosDownloads: Array.from({ length: 5000 }, (_, i) => ({
        date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
        downloads: i,
      })),
      newSuggestions: Array.from({ length: 900 }, (_, i) => ({
        store: "ios",
        seed: `seed-${i}`,
        term: `some fairly long suggestion term number ${i}`,
      })),
    });

    const pack = buildPack(huge);
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(PACK_MAX_BYTES);
  });

  it("survives a completely empty database", () => {
    const pack = buildPack(
      input({ iosDownloads: [], androidInstalls: [], reviews: null }),
    );

    expect(pack.downloads.ios.recent).toEqual([]);
    expect(pack.reviews).toBeNull();
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(buildPack(input()))).toBe(JSON.stringify(buildPack(input())));
  });

  it("never invents a figure that is absent", () => {
    // A null funnel must stay null. The failure this prevents is a briefing
    // that quietly reports zero impressions, which reads as a catastrophe
    // rather than as an absent report.
    const pack = buildPack(input({ funnel: null }));
    expect(pack.conversion).toBeNull();
    expect(JSON.stringify(pack)).not.toContain("impressions\":0");
  });

  it("carries collector health so staleness is visible", () => {
    const pack = buildPack(
      input({ health: [{ source: "asc-sales", status: "failed", error: "401" }] }),
    );

    expect(pack.pipeline.failing).toContainEqual(
      expect.objectContaining({ source: "asc-sales" }),
    );
  });
});

describe("pipelineBroken", () => {
  it("is true when a core collector is failing", () => {
    // The stale-data guard. Analysing numbers produced by a broken pipeline
    // produces confident nonsense, so the run must be able to refuse.
    expect(
      pipelineBroken(buildPack(input({ health: [{ source: "play-details:uz", status: "failed" }] }))),
    ).toBe(true);
  });

  it("ignores a failing collector that feeds nothing the report claims", () => {
    expect(
      pipelineBroken(buildPack(input({ health: [{ source: "social:youtube", status: "failed" }] }))),
    ).toBe(false);
  });

  it("treats a skipped collector as fine, because skipped is a choice", () => {
    expect(
      pipelineBroken(
        buildPack(input({ health: [{ source: "asc-sales", status: "skipped" }] })),
      ),
    ).toBe(false);
  });

  it("is false on a healthy pipeline", () => {
    expect(pipelineBroken(buildPack(input()))).toBe(false);
  });
});

describe("taught facts and last time's advice", () => {
  it("carries both into the briefing", () => {
    const pack = buildPack(
      input({
        teamFacts: ["exam season starts in May"],
        previousRecommendations: {
          date: "2026-08-14",
          items: [{ action: "reply to the one-star reviews", expectedImpact: "rating up" }],
        },
      }),
    );

    expect(pack.teamFacts).toEqual(["exam season starts in May"]);
    expect(pack.previousRecommendations?.items[0].action).toBe(
      "reply to the one-star reviews",
    );
  });

  it("clips a fact somebody wrote an essay into", () => {
    const pack = buildPack(input({ teamFacts: ["u".repeat(900)] }));

    expect(pack.teamFacts[0].length).toBeLessThan(400);
  });

  it("gives up what it was taught last of all", () => {
    /*
     * The shrink order is the judgement here. A briefing that has to lose
     * something should lose keyword rows long before it loses what the team
     * taught it or what it advised yesterday, because those two are the only
     * things in the pack it could not have worked out for itself.
     */
    const pack = buildPack(
      input({
        teamFacts: ["a taught fact"],
        previousRecommendations: {
          date: "2026-08-14",
          items: [{ action: "do the thing", expectedImpact: "number goes up" }],
        },
        keywords: Array.from({ length: 2_000 }, (_, i) => ({
          keyword: `keyword number ${i}`,
          position: i,
          previous: i + 1,
        })),
      }),
    );

    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(PACK_MAX_BYTES);
    expect(pack.keywords).toHaveLength(10);
    expect(pack.teamFacts).toEqual(["a taught fact"]);
    expect(pack.previousRecommendations).not.toBeNull();
  });
});
