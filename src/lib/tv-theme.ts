/**
 * Which theme the wall display wears, decided by the clock.
 *
 * Kept pure and separate from the page so the boundary can be tested without
 * waiting until seven in the evening.
 *
 * The screen lives in an office in Tashkent, so the hour is read in that zone
 * rather than in UTC or in whatever region the server happens to run in. A
 * dashboard rendered on Vercel would otherwise go dark in the early afternoon.
 */

export const TV_TIMEZONE = "Asia/Tashkent";

/** Light from this hour. */
export const DAY_STARTS_HOUR = 7;

/** Dark from this hour. */
export const DAY_ENDS_HOUR = 19;

export type TvTheme = "light" | "dark";

/** Local hour, 0 to 23, in the display's own timezone. */
export function hourInTimezone(now: Date = new Date(), timeZone = TV_TIMEZONE): number {
  // Intl is the only correct way to do this: it accounts for the zone's offset
  // without hardcoding it, so a future daylight-saving change cannot silently
  // shift the boundary by an hour.
  const formatted = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(now);

  // Some locales render midnight as 24; normalise it back to 0.
  return Number.parseInt(formatted, 10) % 24;
}

export function themeForHour(hour: number): TvTheme {
  return hour >= DAY_STARTS_HOUR && hour < DAY_ENDS_HOUR ? "light" : "dark";
}

export function currentTvTheme(now: Date = new Date()): TvTheme {
  return themeForHour(hourInTimezone(now));
}
