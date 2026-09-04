import { describe, expect, it } from "vitest";

import {
  chartMovers,
  listingDiffs,
  releaseNoteExcerpt,
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

  it("carries the new version and release notes when those fields changed", () => {
    // The field names alone say "changed version, release notes", which is
    // true and useless. What shipped is the part somebody wants to read.
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { version: "2.2.7", releaseNotes: "old" }),
      version("app", "2026-08-17T00:00:00Z", { version: "2.2.8", releaseNotes: "new" }),
    ];

    const change = listingDiffs(rows)[0];
    expect(change.version).toBe("2.2.8");
    expect(change.releaseNotes).toBe("new");
  });

  it("carries only what actually changed", () => {
    // A screenshot swap is not a release. Reporting the unchanged version
    // beside it would read as one, which is the mistake worth avoiding.
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { version: "2.2.8", screenshots: ["s1"] }),
      version("app", "2026-08-12T00:00:00Z", { version: "2.2.8", screenshots: ["s2"] }),
    ];

    const change = listingDiffs(rows)[0];
    expect(change.version).toBeNull();
    expect(change.releaseNotes).toBeNull();
  });

  it("reports a version change on a store that publishes no notes", () => {
    // Play's parser reads title, description and version only, so an Android
    // release arrives with a version and nothing to quote.
    const rows = [
      version("app", "2026-08-10T00:00:00Z", { version: "2.2.7" }),
      version("app", "2026-08-16T00:00:00Z", { version: "2.2.8" }),
    ];

    const change = listingDiffs(rows)[0];
    expect(change.version).toBe("2.2.8");
    expect(change.releaseNotes).toBeNull();
  });
});

describe("releaseNoteExcerpt", () => {
  it("returns short notes unchanged", () => {
    expect(releaseNoteExcerpt("Kichik xatoliklar tuzatildi", 240)).toBe(
      "Kichik xatoliklar tuzatildi",
    );
  });

  it("cuts at a word boundary and marks the cut", () => {
    const notes = "one two three four five six seven eight nine ten";
    const excerpt = releaseNoteExcerpt(notes, 20);
    expect(excerpt).toBe("one two three four\u2026");
    // The point of the cap is a row that stays a row.
    expect(excerpt?.length).toBeLessThanOrEqual(21);
  });

  it("collapses the blank lines release notes are full of", () => {
    // Apple's notes arrive as a list separated by blank lines. Rendered raw in
    // a one-line row that is a column of gaps, so they become a sentence.
    expect(releaseNoteExcerpt("Tezlik yaxshilandi\n\nDizayn optimizatsiya", 240)).toBe(
      "Tezlik yaxshilandi Dizayn optimizatsiya",
    );
  });

  it("has nothing to say about nothing", () => {
    expect(releaseNoteExcerpt(null, 240)).toBeNull();
    expect(releaseNoteExcerpt("   ", 240)).toBeNull();
  });
});
