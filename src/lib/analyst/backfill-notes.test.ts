import { describe, expect, it } from "vitest";

import { replaySeries } from "./backfill-notes";

/**
 * Replaying the rules over past days.
 *
 * The property that matters is that a replay says what the daily run would
 * have said on those mornings. If it found movements the live rule would not
 * have reported, the feed would fill with things nobody was ever told about.
 */

const DOWNLOADS = { key: "ios_downloads", label: "App Store downloads" } as const;
const BOUNDS = { slumpShare: 0.4, surgeShare: 2 };

const steady = (count: number, value = 100) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    value,
  }));

describe("replaySeries", () => {
  it("finds a movement on the day it happened", () => {
    const days = [...steady(10), { date: "2026-08-11", value: 240 }];

    const found = replaySeries([{ subject: DOWNLOADS, days, bounds: BOUNDS }], 30);

    expect(found).toHaveLength(1);
    expect(found[0].date).toBe("2026-08-11");
    expect(found[0].direction).toBe("up");
  });

  it("inherits the debounce rather than reporting every day of a run", () => {
    /*
     * The failure this guards against: a surge lasting a week appearing in the
     * feed seven times. The replay calls the same rule, so the crossing test
     * applies to history exactly as it does to this morning.
     */
    const days = [
      ...steady(10),
      { date: "2026-08-11", value: 240 },
      { date: "2026-08-12", value: 250 },
      { date: "2026-08-13", value: 260 },
    ];

    const found = replaySeries([{ subject: DOWNLOADS, days, bounds: BOUNDS }], 30);

    expect(found.map((m) => m.date)).toEqual(["2026-08-11"]);
  });

  it("returns the newest first, so a capped run explains recent news", () => {
    const days = [
      ...steady(10),
      { date: "2026-08-11", value: 240 },
      { date: "2026-08-12", value: 100 },
      { date: "2026-08-13", value: 20 },
    ];

    const found = replaySeries([{ subject: DOWNLOADS, days, bounds: BOUNDS }], 30);

    expect(found.map((m) => m.date)).toEqual(["2026-08-13", "2026-08-11"]);
  });

  it("says nothing about a series that never moved", () => {
    expect(
      replaySeries([{ subject: DOWNLOADS, days: steady(30), bounds: BOUNDS }], 30),
    ).toEqual([]);
  });

  it("keeps enough history behind the window to judge the first day", () => {
    /*
     * A window of one still has to look back a fortnight, because the rule
     * compares a day against the days behind it. Slicing to the window itself
     * would leave the rule too little history and it would refuse to speak.
     */
    const days = [...steady(20), { date: "2026-08-21", value: 240 }];

    const found = replaySeries([{ subject: DOWNLOADS, days, bounds: BOUNDS }], 1);

    expect(found.map((m) => m.date)).toEqual(["2026-08-21"]);
  });
});
