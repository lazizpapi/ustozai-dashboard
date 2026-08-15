import { describe, expect, it } from "vitest";

import {
  chartMovers,
  listingDiffs,
  type ChartAppRow,
  type ListingVersionRow,
} from "./market";

/**
 * Reductions for the market page: who moved in the chart, and who changed
 * their store listing. Pure so they can be pinned here without a database.
 */

function row(date: string, rank: number, storeId: string, name = storeId): ChartAppRow {
  return { date, rank, storeId, name };
}

describe("chartMovers", () => {
  it("compares today against yesterday and a week ago", () => {
    const rows = [
      row("2026-08-08", 5, "a"),
      row("2026-08-14", 3, "a"),
      row("2026-08-15", 1, "a"),
    ];

    const { date, movers } = chartMovers(rows);
    expect(date).toBe("2026-08-15");
    // Rank 3 → 1 is a move UP of 2, expressed as positive.
    expect(movers[0]).toMatchObject({ rank: 1, vsYesterday: 2, vsWeek: 4, isNew: false });
  });

  it("marks an app absent yesterday as new, with no fabricated deltas", () => {
    const rows = [row("2026-08-14", 1, "old"), row("2026-08-15", 2, "fresh")];

    const fresh = chartMovers(rows).movers.find((m) => m.storeId === "fresh");
    expect(fresh).toMatchObject({ isNew: true, vsYesterday: null, vsWeek: null });
  });

  it("reports a fall as negative", () => {
    const rows = [row("2026-08-14", 1, "a"), row("2026-08-15", 4, "a")];
    expect(chartMovers(rows).movers[0].vsYesterday).toBe(-3);
  });

  it("uses only the exact comparison dates, never a nearby one", () => {
    // A gap in collection must read as "no comparison", not silently compare
    // against whatever day happens to exist.
    const rows = [row("2026-08-12", 9, "a"), row("2026-08-15", 1, "a")];
    expect(chartMovers(rows).movers[0].vsYesterday).toBeNull();
  });

  it("handles no rows at all", () => {
    expect(chartMovers([])).toEqual({ date: null, movers: [] });
  });

  it("orders the result by rank", () => {
    const rows = [row("2026-08-15", 2, "b"), row("2026-08-15", 1, "a")];
    expect(chartMovers(rows).movers.map((m) => m.rank)).toEqual([1, 2]);
  });
});

function version(
  appId: string,
  detectedAt: string,
  fields: ListingVersionRow["fields"],
): ListingVersionRow {
  return { appId, appName: appId, platform: "ios", fields, detectedAt };
}

describe("listingDiffs", () => {
  it("names exactly the fields that changed between consecutive versions", () => {
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { title: "A", description: "x" }),
      version("app", "2026-08-14T00:00:00Z", { title: "A", description: "y" }),
    ];

    const changes = listingDiffs(rows);
    expect(changes).toHaveLength(1);
    expect(changes[0].changedFields).toEqual(["description"]);
    expect(changes[0].detectedAt).toBe("2026-08-14T00:00:00Z");
  });

  it("does not report the first recorded version as a change", () => {
    // The baseline is us starting to watch, not them doing anything.
    expect(listingDiffs([version("app", "2026-08-10T00:00:00Z", { title: "A" })])).toEqual([]);
  });

  it("keeps apps separate and returns newest first", () => {
    const rows = [
      version("a", "2026-08-10T00:00:00Z", { title: "1" }),
      version("a", "2026-08-11T00:00:00Z", { title: "2" }),
      version("b", "2026-08-09T00:00:00Z", { title: "1" }),
      version("b", "2026-08-13T00:00:00Z", { title: "2" }),
    ];

    const changes = listingDiffs(rows);
    expect(changes.map((c) => c.appId)).toEqual(["b", "a"]);
  });

  it("sees a changed screenshot set", () => {
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { screenshots: ["s1", "s2"] }),
      version("app", "2026-08-12T00:00:00Z", { screenshots: ["s1", "s3"] }),
    ];
    expect(listingDiffs(rows)[0].changedFields).toEqual(["screenshots"]);
  });

  it("treats null and absent as the same field state", () => {
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { title: "A", version: null }),
      version("app", "2026-08-11T00:00:00Z", { title: "A" }),
    ];
    expect(listingDiffs(rows)).toEqual([]);
  });
});
