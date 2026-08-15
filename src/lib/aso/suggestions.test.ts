import { describe, expect, it } from "vitest";

import { latestSuggestionSets, type SuggestionRow } from "./suggestions";

/**
 * The reduction behind the Suggestions section: for each seed, the newest
 * crawl's terms, with the ones that were absent from the previous crawl
 * flagged. "New" is the whole value of the section — a suggestion appearing
 * is search demand shifting — so the flag logic is what gets pinned.
 */

function row(
  seed: string,
  date: string,
  position: number,
  term: string,
  platform = "ios",
): SuggestionRow {
  return { platform, seed, date, position, term };
}

describe("latestSuggestionSets", () => {
  it("flags terms absent from the previous crawl as new", () => {
    const rows = [
      row("dars", "2026-08-14", 1, "dars jadvali"),
      row("dars", "2026-08-15", 1, "dars jadvali"),
      row("dars", "2026-08-15", 2, "darslik pdf"),
    ];

    const [set] = latestSuggestionSets(rows);
    expect(set.date).toBe("2026-08-15");
    expect(set.terms).toEqual([
      { term: "dars jadvali", position: 1, isNew: false },
      { term: "darslik pdf", position: 2, isNew: true },
    ]);
  });

  it("treats the first crawl as baseline, with nothing marked new", () => {
    // Same convention as listing tracking: starting to watch is not an event.
    const rows = [row("dars", "2026-08-15", 1, "dars jadvali")];
    expect(latestSuggestionSets(rows)[0].terms[0].isNew).toBe(false);
  });

  it("compares against the previous crawl even across a gap in days", () => {
    // Suggestion crawls are daily but a missed day must not turn the whole
    // list "new": the comparison is the newest earlier crawl, whenever it ran.
    const rows = [
      row("dars", "2026-08-10", 1, "dars jadvali"),
      row("dars", "2026-08-15", 1, "dars jadvali"),
    ];
    expect(latestSuggestionSets(rows)[0].terms[0].isNew).toBe(false);
  });

  it("keeps platforms and seeds separate", () => {
    const rows = [
      row("dars", "2026-08-15", 1, "a", "ios"),
      row("dars", "2026-08-15", 1, "b", "android"),
      row("maktab", "2026-08-15", 1, "c", "ios"),
    ];

    const sets = latestSuggestionSets(rows);
    expect(sets).toHaveLength(3);
  });

  it("orders terms by position within a set", () => {
    const rows = [
      row("dars", "2026-08-15", 2, "second"),
      row("dars", "2026-08-15", 1, "first"),
    ];
    expect(latestSuggestionSets(rows)[0].terms.map((t) => t.term)).toEqual([
      "first",
      "second",
    ]);
  });

  it("handles no rows", () => {
    expect(latestSuggestionSets([])).toEqual([]);
  });
});
