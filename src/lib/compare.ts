/**
 * Comparing apps to each other, and today to a while ago.
 *
 * Two honesty problems live here, both of which the market page got wrong
 * before this module existed.
 *
 * Lifetime install totals are not comparable across apps of different ages.
 * Praktika's 19.6 million against our 532 thousand says they are older, not
 * that they are growing faster this week. Velocity is the comparable figure,
 * and counterVelocity derives it from the cumulative counters both stores
 * publish.
 *
 * And a comparison labelled "week" that actually spans four days is exactly
 * the kind of quietly wrong number this dashboard exists to refuse. Rather
 * than showing a dash until the seventh day, priorWithinWindow compares
 * against the oldest reading it has and reports the span, so the caller can
 * label what was really measured.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A reading of some counter at a moment. */
export interface Reading {
  capturedAt: string;
  value: number;
}

export interface Velocity {
  /** Movement per day across the window. Negative when the counter restated down. */
  perDay: number;
  /** Days between the oldest and newest reading used. */
  spanDays: number;
}

const byTimeAscending = (a: Reading, b: Reading) =>
  a.capturedAt.localeCompare(b.capturedAt);

/**
 * How fast a cumulative counter is moving, per day.
 *
 * Endpoints only, deliberately: Play's counter lands in lumps every day or
 * two, so anything that weighted the individual steps would measure Google's
 * publishing schedule rather than the app's growth. Two windows with the same
 * endpoints give the same answer whatever shape the batches took.
 *
 * Null when the readings span less than a day, because extrapolating an hour
 * of movement to a daily rate invents a number nobody measured.
 */
export function counterVelocity(
  readings: Reading[],
  maxWindowDays = 7,
): Velocity | null {
  if (readings.length < 2) return null;

  const ordered = [...readings].sort(byTimeAscending);
  const newest = ordered[ordered.length - 1];
  const cutoff = new Date(newest.capturedAt).getTime() - maxWindowDays * DAY_MS;

  // The oldest reading still inside the window. Anything older would stretch
  // the denominator across weeks the caller did not ask about.
  const oldest = ordered.find(
    (reading) => new Date(reading.capturedAt).getTime() >= cutoff,
  );
  if (!oldest || oldest === newest) return null;

  const elapsed =
    new Date(newest.capturedAt).getTime() - new Date(oldest.capturedAt).getTime();
  if (elapsed < DAY_MS) return null;

  const days = elapsed / DAY_MS;
  return {
    perDay: Math.round((newest.value - oldest.value) / days),
    spanDays: Math.round(days),
  };
}

export interface PriorReading {
  value: number;
  /** Days between that reading and the newest one. */
  spanDays: number;
}

/**
 * The reading to compare today against, and how far back it really is.
 *
 * Prefers one at or before the cutoff, which is the honest week-ago
 * comparison. When collection started more recently than that, it falls back
 * to the oldest reading held rather than refusing to compare: four days of
 * movement is real information, and the returned span lets the caller say so
 * instead of implying a week.
 *
 * Null below a day of separation, for the same reason counterVelocity refuses
 * it: this morning against last night is noise.
 */
export function priorWithinWindow(
  readings: Reading[],
  cutoffIso: string,
): PriorReading | null {
  if (readings.length < 2) return null;

  const ordered = [...readings].sort(byTimeAscending);
  const newest = ordered[ordered.length - 1];
  const newestTime = new Date(newest.capturedAt).getTime();

  const atOrBefore = [...ordered]
    .reverse()
    .find((reading) => reading.capturedAt <= cutoffIso);
  const prior = atOrBefore ?? ordered[0];
  if (prior === newest) return null;

  const elapsed = newestTime - new Date(prior.capturedAt).getTime();
  if (elapsed < DAY_MS) return null;

  return { value: prior.value, spanDays: Math.round(elapsed / DAY_MS) };
}

/**
 * Tashkent's calendar date for a moment.
 *
 * en-CA formats as YYYY-MM-DD, which is both what the database stores and what
 * sorts correctly as a string. Bucketing by UTC instead would file a 20:00
 * reading under the previous day and shift a whole chart by one.
 */
const tashkentDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/**
 * One axis tick per day, at that day's first reading.
 *
 * Charts of hourly readings label every tick with a date, so recharts picking
 * evenly spaced ticks printed "13 Aug" three times in a row and the axis read
 * as broken. Handing it explicit ticks fixes that at the source: each label
 * now marks the point where that day actually begins.
 *
 * Thinned to `max` when a long window would otherwise overprint, always
 * keeping the newest day, which is the end of the axis people read first.
 */
export function dayTicks(capturedAts: string[], max = 8): string[] {
  const seen = new Set<string>();
  const firsts: string[] = [];

  for (const capturedAt of [...capturedAts].sort()) {
    const day = tashkentDay(capturedAt);
    if (seen.has(day)) continue;
    seen.add(day);
    firsts.push(capturedAt);
  }

  if (firsts.length <= max) return firsts;

  // Counting back from the newest so the last day always survives.
  const step = Math.ceil(firsts.length / max);
  return firsts.filter((_, index) => (firsts.length - 1 - index) % step === 0);
}

export interface RankReading {
  capturedAt: string;
  /** Which app, as the key the chart will plot. */
  slug: string;
  /** Null means the poll ran and the app sat outside the chart. */
  rank: number | null;
}

/** One row per day, holding every app's rank that day. */
export type RankSeriesPoint = { date: string } & Record<string, string | number | null>;

/**
 * Hourly rank readings reduced to one row per day, shaped for a line chart.
 *
 * The last reading of each day wins, matching how the rankings page treats a
 * day's position. Nulls are preserved rather than dropped: outside the chart
 * is a fact about the app, and the line should break there rather than
 * interpolate across it.
 */
export function dailyRankSeries(readings: RankReading[]): RankSeriesPoint[] {
  // date -> slug -> rank, with later readings overwriting earlier ones.
  const byDay = new Map<string, Map<string, number | null>>();

  for (const reading of [...readings].sort((a, b) =>
    a.capturedAt.localeCompare(b.capturedAt),
  )) {
    const date = tashkentDay(reading.capturedAt);
    const day = byDay.get(date) ?? new Map<string, number | null>();
    day.set(reading.slug, reading.rank);
    byDay.set(date, day);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ranks]) => ({ date, ...Object.fromEntries(ranks) }));
}
