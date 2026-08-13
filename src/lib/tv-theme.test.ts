import { describe, expect, it } from "vitest";

import {
  DAY_ENDS_HOUR,
  DAY_STARTS_HOUR,
  currentTvTheme,
  hourInTimezone,
  themeForHour,
} from "./tv-theme";

/**
 * The boundary is the whole point of this module, so it is pinned exactly.
 * Off-by-one here means the wall goes dark an hour into the working day, which
 * nobody would report as a bug; they would just find the screen slightly wrong.
 */

describe("themeForHour", () => {
  it("is dark right up to the moment the day starts", () => {
    expect(themeForHour(DAY_STARTS_HOUR - 1)).toBe("dark");
    expect(themeForHour(DAY_STARTS_HOUR)).toBe("light");
  });

  it("is light right up to the moment the day ends", () => {
    expect(themeForHour(DAY_ENDS_HOUR - 1)).toBe("light");
    expect(themeForHour(DAY_ENDS_HOUR)).toBe("dark");
  });

  it("is dark through the night", () => {
    for (const hour of [0, 3, 6, 20, 23]) {
      expect(themeForHour(hour)).toBe("dark");
    }
  });

  it("is light across the working day", () => {
    for (const hour of [7, 9, 12, 15, 18]) {
      expect(themeForHour(hour)).toBe("light");
    }
  });
});

describe("hourInTimezone", () => {
  it("reads the hour in Tashkent, not in UTC", () => {
    // Tashkent runs UTC+5 with no daylight saving. 02:00 UTC is 07:00 there,
    // which is exactly the boundary, so a server thinking in UTC would keep
    // the screen dark for the first five hours of the working day.
    const utcEarlyMorning = new Date("2026-08-12T02:00:00Z");

    expect(hourInTimezone(utcEarlyMorning, "UTC")).toBe(2);
    expect(hourInTimezone(utcEarlyMorning)).toBe(7);
  });

  it("normalises midnight to zero rather than twenty four", () => {
    // en-GB with hour12 false renders midnight as 24 in some environments,
    // which would fall outside a 0 to 23 range check.
    expect(hourInTimezone(new Date("2026-08-11T19:00:00Z"))).toBe(0);
  });
});

describe("currentTvTheme", () => {
  it("turns the Tashkent clock into a theme", () => {
    // 02:00 UTC is 07:00 Tashkent: the screen should already be light.
    expect(currentTvTheme(new Date("2026-08-12T02:00:00Z"))).toBe("light");
    // 14:00 UTC is 19:00 Tashkent: evening, back to dark.
    expect(currentTvTheme(new Date("2026-08-12T14:00:00Z"))).toBe("dark");
  });
});
