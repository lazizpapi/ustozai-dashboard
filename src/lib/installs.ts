/**
 * Reading a daily install rate out of Google's batch counter.
 *
 * Google publishes a running total rather than daily installs, and updates it
 * in batches: observed here landing every day or two, not every day. So the
 * per-day series derived by differencing it looks like 0, 912, 0, where the
 * 912 is two days of installs arriving at once and the zeros mean "the batch
 * has not landed", not "nobody installed".
 *
 * Showing any one element of that series as today's installs is wrong in one
 * of two directions: a zero reads as a collapse, and the batch day reads as
 * roughly double the real rate. This spreads a movement across the days it
 * actually covers, which also makes the figure comparable to the App Store
 * number beside it on the overview.
 */

export interface DailyInstallPoint {
  date: string;
  installs: number;
}

export interface InstallRate {
  /** Installs per day across the span the movement covers. */
  perDay: number;
  /** The batch total, as Google's counter moved it. */
  installs: number;
  /** Days the batch covers. 1 means a genuine single day. */
  spanDays: number;
  /** The day the counter last moved. */
  date: string;
}

/**
 * The most recent real movement, as a per-day rate.
 *
 * Returns null when the counter has never moved in the window, which the
 * caller renders as no reading rather than as zero: those are different
 * claims, and only one of them is true.
 */
export function latestInstallRate(daily: DailyInstallPoint[]): InstallRate | null {
  // Trailing zeros are the in-progress tail: the batch covering today has not
  // landed. They belong to no span, so they are dropped rather than counted.
  let end = daily.length - 1;
  while (end >= 0 && daily[end].installs === 0) end -= 1;
  if (end < 0) return null;

  const movement = daily[end];

  // Zeros immediately before a movement are days the batch also covers: the
  // counter sat still through them and then jumped once for all of them.
  let dormant = 0;
  for (let i = end - 1; i >= 0 && daily[i].installs === 0; i -= 1) dormant += 1;

  const spanDays = dormant + 1;
  return {
    perDay: Math.round(movement.installs / spanDays),
    installs: movement.installs,
    spanDays,
    date: movement.date,
  };
}
