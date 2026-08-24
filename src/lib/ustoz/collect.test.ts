/**
 * The two windows a collection run asks for.
 *
 * Worth pinning because the bug this replaced was invisible from the outside.
 * /statistics/visit-summary answers for whatever range it is handed, as one
 * number, so handing it the backfill window produced a perfectly plausible
 * figure that happened to describe a different span than the row it was
 * written to. The dashboard showed 29.4 minutes against a true daily figure
 * nearer 8, and nothing anywhere reported an error.
 *
 * The invariant is one line long: the daily window is always one day, whatever
 * the run was asked to backfill.
 */

import { describe, expect, it } from "vitest";

import { ustozRanges } from "./collect";

describe("ustozRanges", () => {
  it("gives the per-day endpoints the whole backfill window", () => {
    const { wide } = ustozRanges("2026-08-24", "2026-08-17");

    expect(wide).toEqual({ startDate: "2026-08-17", endDate: "2026-08-24" });
  });

  it("gives the visit summary a single day", () => {
    const { daily } = ustozRanges("2026-08-24", "2026-08-17");

    expect(daily).toEqual({ startDate: "2026-08-24", endDate: "2026-08-24" });
  });

  it("keeps the daily window one day however wide the backfill", () => {
    // The case that broke it: `backfill-ustoz?days=250` stamped a
    // two-hundred-and-fifty-day average onto today. A wider request must widen
    // the series endpoints and nothing else.
    for (const earliest of ["2026-08-23", "2026-05-24", "2025-08-24", "2025-06-19"]) {
      const { wide, daily } = ustozRanges("2026-08-24", earliest);

      expect(daily.startDate).toBe(daily.endDate);
      expect(daily.endDate).toBe("2026-08-24");
      expect(wide.startDate).toBe(earliest);
    }
  });

  it("still asks for one day when the backfill is one day", () => {
    const { wide, daily } = ustozRanges("2026-08-24", "2026-08-24");

    expect(wide).toEqual(daily);
  });
});
