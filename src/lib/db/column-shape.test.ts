/**
 * One upsert per column shape.
 *
 * supabase-js sends a batch as a single upsert whose column list is the union
 * of every row's keys, and fills a row's missing keys with null. The hourly
 * poll wrote today's session length in the same batch as a week of view
 * counts, so every hour it wrote null over the session length of the six days
 * before. Nothing errored; the tile only read today, so nobody saw it until the
 * tile moved to yesterday and found an empty row.
 */

import { describe, expect, it } from "vitest";

import { byColumnShape } from "./persist";

describe("byColumnShape", () => {
  it("keeps a row carrying more columns out of a batch of rows carrying fewer", () => {
    const groups = byColumnShape([
      { date: "2026-10-19", views: 31_000 },
      { date: "2026-10-20", views: 35_910, total_logins: 3_100, average_minutes: 21.4 },
      { date: "2026-10-21", views: 9_000 },
    ]);

    expect(groups).toEqual([
      [
        { date: "2026-10-19", views: 31_000 },
        { date: "2026-10-21", views: 9_000 },
      ],
      [{ date: "2026-10-20", views: 35_910, total_logins: 3_100, average_minutes: 21.4 }],
    ]);
  });

  it("treats the same columns in a different order as one shape", () => {
    expect(
      byColumnShape([
        { date: "2026-10-20", views: 1 },
        { views: 2, date: "2026-10-21" },
      ]),
    ).toHaveLength(1);
  });

  it("returns nothing for nothing", () => {
    expect(byColumnShape([])).toEqual([]);
  });
});
