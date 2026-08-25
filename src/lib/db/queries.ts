import "server-only";

import { serviceClient } from "./client";
import {
  ANDROID_PACKAGE,
  COMPETITORS,
  EDUCATION_GENRE,
  IOS_APP_ID,
} from "@/lib/collectors/config";
import { IMPRESSION_EVENTS, PAGE_VIEW_EVENTS, TAP_EVENTS } from "@/lib/asc/discovery";
import { chartMovers, listingDiffs, type ListingChange } from "@/lib/market";
import {
  counterVelocity,
  dailyRankSeries,
  priorWithinWindow,
  velocitySeries,
} from "@/lib/compare";
import { stickiness } from "@/lib/active-users";
import { latestSuggestionSets, type SeedSuggestions } from "@/lib/aso/suggestions";
import type { AnalystReport } from "@/lib/analyst/schema";
import {
  countByBucket,
  netChangeByBucket,
  sumByBucket,
  type GrowthPoint,
  type Period,
  type Reading,
} from "@/lib/growth";

/**
 * Read side.
 *
 * These run on the server with the service role key, behind the auth check in
 * middleware.ts. Row level security stays enabled so the anon key can read
 * nothing directly: the only route to this data is an authenticated request
 * through the app.
 *
 * Every figure that can be compared over time is returned as a Trend so the UI
 * never has to guess whether a missing previous value means "no change" or "no
 * history yet". Those look identical on a chart and mean opposite things in
 * the first week after launch.
 */

/**
 * PostgREST caps a response at 1000 rows whatever limit you ask for.
 *
 * That cap is silent, and combined with an ascending sort it removes the
 * newest data first, which is the worst possible failure for a dashboard: the
 * downloads page confidently reported "latest day recorded, 21 Jul" while the
 * database held rows through 10 Aug. Any query whose result can exceed a
 * thousand rows has to page through it rather than trusting one request.
 */
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    // Safety valve. Nothing here should legitimately run past this.
    if (page > 50) break;
  }
  return all;
}

export interface Trend<T = number> {
  current: T | null;
  previous: T | null;
  capturedAt: string | null;
  /** True when there is simply no history to compare against yet. */
  noHistory: boolean;
  /**
   * Days the comparison actually spans. Null when there is no comparison.
   *
   * Present because it is usually not seven. Collection for a given app can
   * be days old, and a movement measured over four days must not be presented
   * as a week's worth. The formatters turn this into "over 4 days".
   */
  spanDays: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekAgoIso(): string {
  return new Date(Date.now() - WEEK_MS).toISOString();
}

function trend<T>(
  current: T | null,
  previous: T | null,
  capturedAt: string | null,
  spanDays: number | null = null,
): Trend<T> {
  return {
    current,
    previous,
    capturedAt,
    noHistory: previous === null,
    spanDays: previous === null ? null : spanDays,
  };
}

/**
 * The reading to compare the newest against, over whatever span exists.
 *
 * Wraps the tested reduction in compare.ts. Readings without a value are
 * dropped first: a null rank means the app was outside the chart that hour,
 * which is a real state but not a number this can subtract.
 */
function windowedPrior(
  readings: { capturedAt: string; value: number | null }[],
): { value: number; spanDays: number } | null {
  const usable = readings
    .filter((row): row is { capturedAt: string; value: number } => row.value !== null)
    .map((row) => ({ capturedAt: row.capturedAt, value: row.value }));

  return priorWithinWindow(usable, weekAgoIso());
}

/**
 * Our own listing for a platform.
 *
 * The role filter is not optional. The apps table also holds competitors now,
 * and without it this lookup matches several rows and every page that reports
 * on our app fails at once. A partial unique index in migration 0007 keeps the
 * "exactly one own row per platform" side of that promise in the database.
 */
async function appId(platform: "ios" | "android"): Promise<string | null> {
  const { data } = await serviceClient()
    .from("apps")
    .select("id")
    .eq("platform", platform)
    .eq("role", "own")
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// ---------------------------------------------------------------------------
// Chart position
// ---------------------------------------------------------------------------

export interface RankPoint {
  capturedAt: string;
  rank: number | null;
  feedSize: number;
}

/**
 * The platform argument is load-bearing, not decoration.
 *
 * chart_ranks holds both stores, separated only by which app row each rank
 * points at. Reading without filtering would return Apple and Play positions
 * interleaved on one timeline, and the resulting chart would look like the app
 * lurching sixteen places every hour.
 */
export async function rankHistory(
  chartType = "topfree",
  country = "uz",
  genre: string = EDUCATION_GENRE,
  days = 90,
  platform: "ios" | "android" = "ios",
): Promise<RankPoint[]> {
  const id = await appId(platform);
  if (!id) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const data = await fetchAllPages<{
    captured_at: string;
    rank: number | null;
    feed_size: number;
  }>(
    (from, to) =>
      serviceClient()
        .from("chart_ranks")
        .select("captured_at, rank, feed_size")
        .eq("app_id", id)
        .eq("country", country)
        .eq("chart_type", chartType)
        .eq("genre", genre)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true })
        .range(from, to),
    "rankHistory",
  );

  return data.map((row) => ({
    capturedAt: row.captured_at as string,
    rank: row.rank as number | null,
    feedSize: row.feed_size as number,
  }));
}

export async function rankTrend(
  chartType = "topfree",
  country = "uz",
  genre: string = EDUCATION_GENRE,
  platform: "ios" | "android" = "ios",
): Promise<Trend & { feedSize: number | null }> {
  const history = await rankHistory(chartType, country, genre, 30, platform);
  if (history.length === 0) {
    return { ...trend<number>(null, null, null), feedSize: null };
  }

  const latest = history[history.length - 1];
  const older = windowedPrior(
    history.map((point) => ({ capturedAt: point.capturedAt, value: point.rank })),
  );

  return {
    ...trend(latest.rank, older?.value ?? null, latest.capturedAt, older?.spanDays ?? null),
    feedSize: latest.feedSize,
  };
}

// ---------------------------------------------------------------------------
// Ratings and installs
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  capturedAt: string;
  rating: number | null;
  ratingCount: number | null;
  installCount: number | null;
  installLabel: string | null;
}

export async function snapshotHistory(
  platform: "ios" | "android",
  country = "uz",
  days = 90,
): Promise<SnapshotRow[]> {
  const id = await appId(platform);
  if (!id) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const data = await fetchAllPages<{
    captured_at: string;
    rating: number | null;
    rating_count: number | null;
    install_count: number | null;
    install_label: string | null;
  }>(
    (from, to) =>
      serviceClient()
        .from("metric_snapshots")
        .select("captured_at, rating, rating_count, install_count, install_label")
        .eq("app_id", id)
        .eq("country", country)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true })
        .range(from, to),
    "snapshotHistory",
  );

  return data.map((row) => ({
    capturedAt: row.captured_at as string,
    rating: row.rating as number | null,
    ratingCount: row.rating_count as number | null,
    installCount: row.install_count as number | null,
    installLabel: row.install_label as string | null,
  }));
}

export async function ratingTrend(
  platform: "ios" | "android",
  country = "uz",
): Promise<Trend & { ratingCount: number | null }> {
  const history = await snapshotHistory(platform, country, 30);
  if (history.length === 0) return { ...trend<number>(null, null, null), ratingCount: null };

  const latest = history[history.length - 1];
  const older = windowedPrior(
    history.map((row) => ({ capturedAt: row.capturedAt, value: row.rating })),
  );

  return {
    ...trend(latest.rating, older?.value ?? null, latest.capturedAt, older?.spanDays ?? null),
    ratingCount: latest.ratingCount,
  };
}

/**
 * Daily Android installs, derived as the difference between consecutive
 * cumulative snapshots.
 *
 * Play publishes a running total, not a daily figure, so the delta is the only
 * way to get one. Negative deltas are dropped rather than shown: Play's
 * "installs by unique users" can tick down when accounts are removed, and a
 * negative install count on a chart reads as a bug.
 */
export interface DailyInstalls {
  date: string;
  installs: number;
}

export async function androidDailyInstalls(days = 60): Promise<DailyInstalls[]> {
  const history = await snapshotHistory("android", "uz", days);

  const dailyMax = new Map<string, number>();
  for (const row of history) {
    if (row.installCount === null) continue;
    const date = row.capturedAt.slice(0, 10);
    dailyMax.set(date, Math.max(dailyMax.get(date) ?? 0, row.installCount));
  }

  const dates = [...dailyMax.keys()].sort();
  const result: DailyInstalls[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    const delta = dailyMax.get(dates[i])! - dailyMax.get(dates[i - 1])!;
    if (delta >= 0) result.push({ date: dates[i], installs: delta });
  }
  return result;
}

/**
 * Installs accumulated since the first reading of the current day.
 *
 * A daily figure is the gap between two days, so on the first day of tracking
 * there is nothing to subtract from and the tile would sit empty even though
 * Play's cumulative counter has plainly moved. This returns that partial
 * movement so the number can be shown honestly, labelled as the day so far
 * rather than dressed up as a complete day.
 *
 * Null when there is only one reading, because a single point is not a change.
 */
export async function androidInstallsSoFarToday(): Promise<{
  installs: number;
  since: string;
} | null> {
  const history = await snapshotHistory("android", "uz", 2);
  const today = new Date().toISOString().slice(0, 10);

  const todays = history.filter(
    (row) => row.capturedAt.slice(0, 10) === today && row.installCount !== null,
  );
  if (todays.length < 2) return null;

  const first = todays[0];
  const last = todays[todays.length - 1];
  const installs = last.installCount! - first.installCount!;

  // Play's "installs by unique users" can tick down when accounts go away, and
  // a negative install count reads as a bug rather than as churn.
  if (installs < 0) return null;

  return { installs, since: first.capturedAt };
}

// ---------------------------------------------------------------------------
// iOS downloads
// ---------------------------------------------------------------------------

export interface DailyDownloads {
  date: string;
  downloads: number;
  updates: number;
}

export async function iosDailyDownloads(days = 60): Promise<DailyDownloads[]> {
  const id = await appId("ios");
  if (!id) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Paged: this table holds one row per country per download type per day, so
  // even a two month window runs past a thousand rows.
  const data = await fetchAllPages<{ date: string; download_type: string; units: number }>(
    (from, to) =>
      serviceClient()
        .from("ios_downloads_daily")
        .select("date, download_type, units")
        .eq("app_id", id)
        .eq("source", "sales")
        .gte("date", since)
        .order("date", { ascending: true })
        .range(from, to),
    "iosDailyDownloads",
  );

  const byDate = new Map<string, DailyDownloads>();
  for (const row of data) {
    const date = row.date as string;
    const entry = byDate.get(date) ?? { date, downloads: 0, updates: 0 };
    if (row.download_type === "update") entry.updates += row.units as number;
    else entry.downloads += row.units as number;
    byDate.set(date, entry);
  }
  return [...byDate.values()];
}

export interface ProceedsTotal {
  currency: string;
  proceeds: number;
  units: number;
  from: string;
  to: string;
}

/**
 * What Apple actually owes us, by currency.
 *
 * Expected to be empty, and the page treats empty as "nothing to show" rather
 * than as a fault. The app is a free download paid for through Payme and
 * Click, so Apple collects nothing on its behalf; a row appears here only if
 * an in-app purchase is ever sold.
 *
 * Grouped by currency rather than converted. Apple settles in the currency of
 * each storefront and publishes no rate in this report, so adding them would
 * mean inventing one.
 */
export async function iosProceeds(days = 30): Promise<ProceedsTotal[]> {
  const id = await appId("ios");
  if (!id) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const data = await fetchAllPages<{
    date: string;
    currency: string;
    proceeds: number;
    units: number;
  }>(
    (from, to) =>
      serviceClient()
        .from("ios_proceeds_daily")
        .select("date, currency, proceeds, units")
        .eq("app_id", id)
        .gte("date", since)
        .order("date", { ascending: true })
        .range(from, to),
    "iosProceeds",
  );

  const byCurrency = new Map<string, ProceedsTotal>();
  for (const row of data) {
    const currency = row.currency as string;
    const date = row.date as string;
    const entry = byCurrency.get(currency) ?? {
      currency,
      proceeds: 0,
      units: 0,
      from: date,
      to: date,
    };
    entry.proceeds += Number(row.proceeds) || 0;
    entry.units += Number(row.units) || 0;
    if (date < entry.from) entry.from = date;
    if (date > entry.to) entry.to = date;
    byCurrency.set(currency, entry);
  }

  return [...byCurrency.values()].sort((a, b) => b.proceeds - a.proceeds);
}

// ---------------------------------------------------------------------------
// Keywords, reviews, health
// ---------------------------------------------------------------------------

export interface KeywordRow {
  keyword: string;
  position: number | null;
  previous: number | null;
  resultCount: number;
  capturedAt: string;
}

export async function latestKeywordRanks(country = "uz"): Promise<KeywordRow[]> {
  const id = await appId("ios");
  if (!id) return [];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await serviceClient()
    .from("keyword_ranks")
    .select("keyword, position, result_count, captured_at")
    .eq("app_id", id)
    .eq("country", country)
    .gte("captured_at", since)
    .order("captured_at", { ascending: false });

  if (error) throw new Error(`latestKeywordRanks: ${error.message}`);

  const cutoff = weekAgoIso();
  const latest = new Map<string, KeywordRow>();
  for (const row of data ?? []) {
    const keyword = row.keyword as string;
    const existing = latest.get(keyword);
    if (!existing) {
      latest.set(keyword, {
        keyword,
        position: row.position as number | null,
        previous: null,
        resultCount: row.result_count as number,
        capturedAt: row.captured_at as string,
      });
    } else if (existing.previous === null && (row.captured_at as string) <= cutoff) {
      existing.previous = row.position as number | null;
    }
  }
  return [...latest.values()];
}

/**
 * Latest suggestion crawl per seed with new-since-last-crawl flags.
 *
 * Eight days of rows so the comparison crawl is present even after a missed
 * day or two; the reduction is pure and pinned in suggestions.test.ts. Can
 * exceed a thousand rows (seeds × terms × days), hence the paging.
 */
export async function keywordSuggestionSets(): Promise<SeedSuggestions[]> {
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = await fetchAllPages<{
    platform: string;
    seed: string;
    date: string;
    position: number;
    term: string;
  }>(
    (from, to) =>
      serviceClient()
        .from("keyword_suggestions")
        .select("platform, seed, date, position, term")
        .gte("date", since)
        .order("date", { ascending: false })
        .order("seed")
        .order("position")
        .range(from, to),
    "keywordSuggestionSets",
  );

  return latestSuggestionSets(rows);
}

export interface ReviewRow {
  id: string;
  platform: string;
  country: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: string | null;
  submittedAt: string | null;
}

/**
 * @param since Optional ISO cutoff on submitted_at.
 *
 * The digest passes it. Without it, "reviews from the last day" had to be
 * approximated by taking the newest N and filtering in JavaScript, which is
 * only correct while N exceeds the number of reviews that can arrive in a day.
 * Collecting Google Play as well as the App Store roughly doubled that rate,
 * so the window is now a condition on the query rather than a guess about the
 * limit.
 */
export async function recentReviews(limit = 25, since?: string): Promise<ReviewRow[]> {
  const base = serviceClient()
    .from("reviews")
    .select("id, country, rating, title, body, author, submitted_at, apps!inner(platform, role)")
    // Same guard as reviewTimestamps: the digest reads through here.
    .eq("apps.role", "own");

  const { data, error } = await (since ? base.gte("submitted_at", since) : base)
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`recentReviews: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    platform: (row.apps as unknown as { platform: string }).platform,
    country: row.country as string,
    rating: row.rating as number,
    title: row.title as string | null,
    body: row.body as string | null,
    author: row.author as string | null,
    submittedAt: row.submitted_at as string | null,
  }));
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

export interface SocialTrend extends Trend {
  platform: "telegram" | "instagram" | "youtube";
  handle: string | null;
  /** False when the platform publishes a rounded figure, as YouTube does. */
  isExact: boolean;
  /**
   * When the platform was last actually reached, as opposed to capturedAt,
   * which is the hour the reading is filed under. Only this one can answer
   * "how current is that number" to the minute.
   */
  checkedAt: string | null;
  /**
   * Older than the staleness window. Decided here rather than in a component:
   * it is a property of the reading, and comparing against the clock during
   * render is impure.
   */
  isStale: boolean;
}

/** Instagram blocking us shows up as a reading that stops advancing. */
const SOCIAL_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const SOCIAL_PLATFORMS = ["telegram", "instagram", "youtube"] as const;

/**
 * Latest follower count per platform with a week-ago comparison.
 *
 * Returns an entry for every platform even when nothing has been collected, so
 * the UI can render a consistent set of rows and say why one is missing rather
 * than silently dropping it.
 */
export async function socialTrends(days = 30): Promise<SocialTrend[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await fetchAllPages<{
    platform: string;
    handle: string;
    followers: number;
    is_exact: boolean;
    captured_at: string;
    checked_at: string | null;
  }>(
    (from, to) =>
      serviceClient()
        .from("social_snapshots")
        .select("platform, handle, followers, is_exact, captured_at, checked_at")
        .gte("captured_at", since)
        .order("captured_at", { ascending: false })
        .range(from, to),
    "socialTrends",
  );

  const now = Date.now();

  return SOCIAL_PLATFORMS.map((platform) => {
    // Already newest-first from the query.
    const forPlatform = rows.filter((row) => row.platform === platform);
    const latest = forPlatform[0];
    const older = windowedPrior(
      forPlatform.map((row) => ({ capturedAt: row.captured_at, value: row.followers })),
    );

    if (!latest) {
      return {
        platform,
        handle: null,
        isExact: true,
        checkedAt: null,
        isStale: false,
        ...trend<number>(null, null, null),
      };
    }

    // Staleness is measured from when we last reached the platform, not from
    // the hour the reading is filed under. Those differed by up to an hour
    // even before the fast lane, which was tolerable at a three-hourly cadence
    // and is not at a one-minute one.
    const checkedAt = latest.checked_at ?? latest.captured_at;

    return {
      platform,
      handle: latest.handle,
      isExact: latest.is_exact,
      checkedAt,
      isStale: now - new Date(checkedAt).getTime() > SOCIAL_STALE_AFTER_MS,
      ...trend(
        latest.followers,
        older?.value ?? null,
        latest.captured_at,
        older?.spanDays ?? null,
      ),
    };
  });
}

/**
 * When any platform was last successfully read.
 *
 * Deliberately one row and one column: it runs on every page render to decide
 * whether to go and fetch a new reading, so it has to be the cheapest query in
 * the file.
 */
/**
 * When one platform was last successfully read.
 *
 * Deliberately not the same query as latestAudienceCheck, which answers "any
 * platform" and is right for the page renderer because it refreshes all of
 * them together. The Telegram webhook refreshes only Telegram, so asking the
 * broad question there would let a fresh Instagram reading suppress a Telegram
 * refresh and quietly turn the live path back into a polled one.
 */
// ---------------------------------------------------------------------------
// Market comparison
// ---------------------------------------------------------------------------

export interface MarketApp {
  slug: string;
  name: string;
  isOurs: boolean;
  /** Education chart, UZ, top free. Null rank means outside the feed. */
  rank: number | null;
  rankPrevious: number | null;
  /** Days the rank comparison spans, which is often fewer than seven. */
  rankSpanDays: number | null;
  feedSize: number | null;
  iosRating: number | null;
  iosRatingCount: number | null;
  playInstalls: number | null;
  playInstallsPrevious: number | null;
  playInstallsSpanDays: number | null;
  /**
   * Installs per day, averaged across the readings we hold.
   *
   * The comparable figure. Lifetime totals say how old an app is more than
   * how fast it is growing: Praktika's 19.6 million against our half million
   * is nineteen million installs of history, not of this week.
   */
  playInstallsPerDay: number | null;
  playVelocitySpanDays: number | null;
  playRating: number | null;
  playRatingCount: number | null;
}

/**
 * Us against the apps we track, one row each.
 *
 * Three queries regardless of how many competitors are listed, rather than a
 * few per app. The per-app reduction then happens here, which keeps the round
 * trips flat as the list grows.
 *
 * Ours is pinned first because the question this page answers is always "where
 * are we against them" rather than "who is winning".
 */
export async function marketOverview(): Promise<MarketApp[]> {
  const { data: appRows, error } = await serviceClient()
    .from("apps")
    .select("id, platform, store_id, role");
  if (error) throw new Error(`marketOverview apps: ${error.message}`);

  const byKey = new Map<string, string>(
    (appRows ?? []).map((row) => [`${row.platform}:${row.store_id}`, row.id as string]),
  );
  const allIds = (appRows ?? []).map((row) => row.id as string);
  if (allIds.length === 0) return [];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [ranks, snaps] = await Promise.all([
    fetchAllPages<{ app_id: string; rank: number | null; feed_size: number; captured_at: string }>(
      (from, to) =>
        serviceClient()
          .from("chart_ranks")
          .select("app_id, rank, feed_size, captured_at")
          .in("app_id", allIds)
          .eq("country", "uz")
          .eq("chart_type", "topfree")
          .eq("genre", EDUCATION_GENRE)
          .gte("captured_at", since)
          .order("captured_at", { ascending: false })
          .range(from, to),
      "marketOverview ranks",
    ),
    fetchAllPages<{
      app_id: string;
      rating: number | null;
      rating_count: number | null;
      install_count: number | null;
      captured_at: string;
    }>(
      (from, to) =>
        serviceClient()
          .from("metric_snapshots")
          .select("app_id, rating, rating_count, install_count, captured_at")
          .in("app_id", allIds)
          .eq("country", "uz")
          .gte("captured_at", since)
          .order("captured_at", { ascending: false })
          .range(from, to),
      "marketOverview snapshots",
    ),
  ]);

  const entries = [
    { slug: "ustoz-ai", name: "Ustoz AI", iosId: IOS_APP_ID, androidPackage: ANDROID_PACKAGE, isOurs: true },
    ...COMPETITORS.map((c) => ({ ...c, isOurs: false })),
  ];

  return entries.map((entry) => {
    const iosId = entry.iosId ? byKey.get(`ios:${entry.iosId}`) : undefined;
    const androidId = entry.androidPackage
      ? byKey.get(`android:${entry.androidPackage}`)
      : undefined;

    // Rows arrive newest-first from the query, so [0] is the current reading.
    const rankRows = ranks.filter((row) => row.app_id === iosId);
    const iosRows = snaps.filter((row) => row.app_id === iosId && row.rating !== null);
    const playRows = snaps.filter((row) => row.app_id === androidId);

    const rankPrior = windowedPrior(
      rankRows.map((row) => ({ capturedAt: row.captured_at, value: row.rank })),
    );
    const playPrior = windowedPrior(
      playRows.map((row) => ({ capturedAt: row.captured_at, value: row.install_count })),
    );
    const playVelocity = counterVelocity(
      playRows
        .filter((row) => row.install_count !== null)
        .map((row) => ({ capturedAt: row.captured_at, value: row.install_count as number })),
    );

    return {
      slug: entry.slug,
      name: entry.name,
      isOurs: entry.isOurs,
      rank: rankRows[0]?.rank ?? null,
      rankPrevious: rankPrior?.value ?? null,
      rankSpanDays: rankPrior?.spanDays ?? null,
      feedSize: rankRows[0]?.feed_size ?? null,
      iosRating: iosRows[0]?.rating ?? null,
      iosRatingCount: iosRows[0]?.rating_count ?? null,
      playInstalls: playRows[0]?.install_count ?? null,
      playInstallsPrevious: playPrior?.value ?? null,
      playInstallsSpanDays: playPrior?.spanDays ?? null,
      playInstallsPerDay: playVelocity?.perDay ?? null,
      playVelocitySpanDays: playVelocity?.spanDays ?? null,
      playRating: playRows[0]?.rating ?? null,
      playRatingCount: playRows[0]?.rating_count ?? null,
    };
  });
}

/**
 * Every tracked app's chart position over time, one row per day.
 *
 * The race chart's data. Same filters as marketOverview so the two agree, and
 * the same single query for all apps rather than one per competitor. Apps we
 * hold no iOS id for are absent rather than drawn as an empty line.
 */
export async function competitorRankSeries(days = 30): Promise<{
  points: ReturnType<typeof dailyRankSeries>;
  apps: { slug: string; name: string; isOurs: boolean }[];
}> {
  const { data: appRows, error } = await serviceClient()
    .from("apps")
    .select("id, platform, store_id");
  if (error) throw new Error(`competitorRankSeries apps: ${error.message}`);

  const idByStore = new Map<string, string>(
    (appRows ?? [])
      .filter((row) => row.platform === "ios")
      .map((row) => [row.store_id as string, row.id as string]),
  );

  const entries = [
    { slug: "ustoz-ai", name: "Ustoz AI", iosId: IOS_APP_ID, isOurs: true },
    ...COMPETITORS.map((c) => ({
      slug: c.slug,
      name: c.name,
      iosId: c.iosId,
      isOurs: false,
    })),
  ].filter((entry) => entry.iosId && idByStore.has(entry.iosId));

  if (entries.length === 0) return { points: [], apps: [] };

  const slugById = new Map(entries.map((entry) => [idByStore.get(entry.iosId!)!, entry.slug]));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await fetchAllPages<{
    app_id: string;
    rank: number | null;
    captured_at: string;
  }>(
    (from, to) =>
      serviceClient()
        .from("chart_ranks")
        .select("app_id, rank, captured_at")
        .in("app_id", [...slugById.keys()])
        .eq("country", "uz")
        .eq("chart_type", "topfree")
        .eq("genre", EDUCATION_GENRE)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true })
        .range(from, to),
    "competitorRankSeries",
  );

  return {
    points: dailyRankSeries(
      rows.map((row) => ({
        capturedAt: row.captured_at,
        slug: slugById.get(row.app_id)!,
        rank: row.rank,
      })),
    ),
    apps: entries.map(({ slug, name, isOurs }) => ({ slug, name, isOurs })),
  };
}

// ---------------------------------------------------------------------------
// Market intelligence: the chart's visible top, and listing changes
// ---------------------------------------------------------------------------

/**
 * The Education top-free chart's top 20 with day and week movement.
 *
 * Eight days of rows cover both comparison points chartMovers needs; the
 * reduction itself is pure and pinned in market.test.ts.
 */
export async function educationChartTop(): Promise<ReturnType<typeof chartMovers>> {
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await serviceClient()
    .from("chart_apps")
    .select("date, rank, store_id, name")
    .eq("country", "uz")
    .eq("chart_type", "topfree")
    .eq("genre", EDUCATION_GENRE)
    .gte("date", since)
    .order("date", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`educationChartTop: ${error.message}`);

  return chartMovers(
    (data ?? []).map((row) => ({
      date: row.date as string,
      rank: row.rank as number,
      storeId: row.store_id as string,
      name: row.name as string,
    })),
  );
}

/**
 * Recent listing changes across every tracked app, ours included.
 *
 * Fetches enough versions that each change row still has its predecessor to
 * diff against; the diffing is pure and pinned in market.test.ts.
 */
export async function recentListingChanges(limit = 20): Promise<ListingChange[]> {
  const { data, error } = await serviceClient()
    .from("listing_versions")
    .select("app_id, fields, detected_at, apps!inner(platform, store_id)")
    .order("detected_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`recentListingChanges: ${error.message}`);

  const names = new Map<string, string>([
    [`ios:${IOS_APP_ID}`, "Ustoz AI"],
    [`android:${ANDROID_PACKAGE}`, "Ustoz AI"],
    ...COMPETITORS.flatMap((c): [string, string][] => [
      ...(c.iosId ? [[`ios:${c.iosId}`, c.name] as [string, string]] : []),
      ...(c.androidPackage
        ? [[`android:${c.androidPackage}`, c.name] as [string, string]]
        : []),
    ]),
  ]);

  const rows = (data ?? []).map((row) => {
    const app = row.apps as unknown as { platform: string; store_id: string };
    return {
      appId: row.app_id as string,
      appName: names.get(`${app.platform}:${app.store_id}`) ?? app.store_id,
      platform: app.platform,
      fields: row.fields as Record<string, string | string[] | null>,
      detectedAt: row.detected_at as string,
    };
  });

  return listingDiffs(rows).slice(0, limit);
}

/**
 * Everything we hold about one tracked app, ours included.
 *
 * The drill-down behind a row of the market table. The table can say who is
 * ahead today; this says how they got there.
 *
 * Two figures need naming carefully, because the honest version is less
 * impressive than the one a reader expects.
 *
 * Nobody outside Google can see a competitor's daily installs. What is public
 * is a cumulative total updated in batches, so the velocity series here is
 * that total differenced over a trailing window, which is a real quantity per
 * real day and not an estimate.
 *
 * Apple publishes no competitor downloads at all, at any granularity. The
 * closest public signal is how fast their rating count grows, and this returns
 * that under its own name rather than dressing it up as downloads. It tracks
 * demand only as far as the share of users who rate stays steady, which is an
 * assumption the page states rather than hides.
 */
export interface CompetitorProfile {
  slug: string;
  name: string;
  isOurs: boolean;
  iosId: string | null;
  androidPackage: string | null;
  /** Cumulative Play installs as published, oldest first. */
  playInstalls: { at: string; value: number }[];
  /** Installs per day over a trailing week, one point per day. */
  playVelocity: ReturnType<typeof velocitySeries>;
  /** Growth in App Store ratings per day. A demand proxy, not downloads. */
  iosRatingVelocity: ReturnType<typeof velocitySeries>;
  rankHistory: RankPoint[];
  iosRating: number | null;
  iosRatingCount: number | null;
  playRating: number | null;
  playRatingCount: number | null;
  listingChanges: ListingChange[];
  /** Newest stored listing per platform, for the current title and text. */
  listings: {
    platform: string;
    fields: Record<string, string | string[] | null>;
    detectedAt: string;
  }[];
}

export async function competitorProfile(slug: string): Promise<CompetitorProfile | null> {
  const entry =
    slug === "ustoz-ai"
      ? {
          slug: "ustoz-ai",
          name: "Ustoz AI",
          iosId: IOS_APP_ID,
          androidPackage: ANDROID_PACKAGE,
          isOurs: true,
        }
      : COMPETITORS.map((c) => ({ ...c, isOurs: false })).find((c) => c.slug === slug);

  if (!entry) return null;

  const { data: appRows, error } = await serviceClient()
    .from("apps")
    .select("id, platform, store_id");
  if (error) throw new Error(`competitorProfile apps: ${error.message}`);

  const idFor = (platform: string, storeId: string | null | undefined) =>
    storeId
      ? ((appRows ?? []).find(
          (row) => row.platform === platform && row.store_id === storeId,
        )?.id as string | undefined)
      : undefined;

  const iosAppId = idFor("ios", entry.iosId);
  const androidAppId = idFor("android", entry.androidPackage);
  const ids = [iosAppId, androidAppId].filter((id): id is string => Boolean(id));

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [snaps, ranks, versions] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : fetchAllPages<{
          app_id: string;
          rating: number | null;
          rating_count: number | null;
          install_count: number | null;
          captured_at: string;
        }>(
          (from, to) =>
            serviceClient()
              .from("metric_snapshots")
              .select("app_id, rating, rating_count, install_count, captured_at")
              .in("app_id", ids)
              .eq("country", "uz")
              .gte("captured_at", since)
              .order("captured_at", { ascending: true })
              .range(from, to),
          `competitorProfile snapshots(${slug})`,
        ),
    iosAppId
      ? fetchAllPages<{ captured_at: string; rank: number | null; feed_size: number }>(
          (from, to) =>
            serviceClient()
              .from("chart_ranks")
              .select("captured_at, rank, feed_size")
              .eq("app_id", iosAppId)
              .eq("country", "uz")
              .eq("chart_type", "topfree")
              .eq("genre", EDUCATION_GENRE)
              .gte("captured_at", since)
              .order("captured_at", { ascending: true })
              .range(from, to),
          `competitorProfile ranks(${slug})`,
        )
      : Promise.resolve([]),
    ids.length === 0
      ? Promise.resolve([])
      : fetchAllPages<{
          app_id: string;
          fields: Record<string, string | string[] | null>;
          detected_at: string;
        }>(
          (from, to) =>
            serviceClient()
              .from("listing_versions")
              .select("app_id, fields, detected_at")
              .in("app_id", ids)
              .order("detected_at", { ascending: false })
              .range(from, to),
          `competitorProfile listings(${slug})`,
        ),
  ]);

  const androidSnaps = snaps.filter((row) => row.app_id === androidAppId);
  const iosSnaps = snaps.filter((row) => row.app_id === iosAppId);

  const readings = (
    rows: typeof snaps,
    pick: (row: (typeof snaps)[number]) => number | null,
  ) =>
    rows
      .filter((row) => pick(row) !== null)
      .map((row) => ({ capturedAt: row.captured_at, value: pick(row) as number }));

  const platformOf = (appId: string) => (appId === iosAppId ? "ios" : "android");

  const diffRows = versions.map((row) => ({
    appId: row.app_id,
    appName: entry.name,
    platform: platformOf(row.app_id),
    fields: row.fields,
    detectedAt: row.detected_at,
  }));

  // Newest stored version per platform: the listing as it stands today.
  const newestByPlatform = new Map<string, (typeof diffRows)[number]>();
  for (const row of diffRows) {
    if (!newestByPlatform.has(row.platform)) newestByPlatform.set(row.platform, row);
  }

  const latest = <T,>(rows: T[]): T | undefined => rows[rows.length - 1];

  return {
    slug: entry.slug,
    name: entry.name,
    isOurs: entry.isOurs,
    iosId: entry.iosId ?? null,
    androidPackage: entry.androidPackage ?? null,
    playInstalls: readings(androidSnaps, (row) => row.install_count).map((row) => ({
      at: row.capturedAt,
      value: row.value,
    })),
    playVelocity: velocitySeries(readings(androidSnaps, (row) => row.install_count)),
    iosRatingVelocity: velocitySeries(readings(iosSnaps, (row) => row.rating_count)),
    rankHistory: ranks.map((row) => ({
      capturedAt: row.captured_at,
      rank: row.rank,
      feedSize: row.feed_size,
    })),
    iosRating: latest(iosSnaps.filter((row) => row.rating !== null))?.rating ?? null,
    iosRatingCount:
      latest(iosSnaps.filter((row) => row.rating_count !== null))?.rating_count ?? null,
    playRating: latest(androidSnaps.filter((row) => row.rating !== null))?.rating ?? null,
    playRatingCount:
      latest(androidSnaps.filter((row) => row.rating_count !== null))?.rating_count ?? null,
    listingChanges: listingDiffs(diffRows),
    listings: [...newestByPlatform.values()].map((row) => ({
      platform: row.platform,
      fields: row.fields,
      detectedAt: row.detectedAt,
    })),
  };
}

/** How many apps have a recorded listing baseline, for the empty-state copy. */
export async function watchedListingCount(): Promise<number> {
  const { data, error } = await serviceClient()
    .from("listing_versions")
    .select("app_id")
    .limit(PAGE_SIZE);
  if (error) throw new Error(`watchedListingCount: ${error.message}`);
  return new Set((data ?? []).map((row) => row.app_id as string)).size;
}

// ---------------------------------------------------------------------------
// The analyst's reports
// ---------------------------------------------------------------------------

export interface AnalystRow {
  id: string;
  createdAt: string;
  status: "ok" | "stale-data" | "failed";
  health: "green" | "yellow" | "red" | null;
  headline: string | null;
  report: AnalystReport | null;
  model: string | null;
  error: string | null;
}

function toAnalystRow(row: Record<string, unknown>): AnalystRow {
  return {
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status as AnalystRow["status"],
    health: (row.health as AnalystRow["health"]) ?? null,
    headline: (row.headline as string) ?? null,
    report: (row.report as AnalystReport) ?? null,
    model: (row.model as string) ?? null,
    error: (row.error as string) ?? null,
  };
}

const ANALYST_COLUMNS = "id, created_at, status, health, headline, report, model, error";

/**
 * The newest report worth showing, and the runs around it.
 *
 * "Latest" means the newest successful report rather than the newest row: a
 * failed or refused run should not blank the page, because the last good
 * analysis is still the best available answer. The recent list is unfiltered,
 * so a run of failures is visible rather than hidden behind a stale report.
 */
export async function latestAnalystReport(): Promise<AnalystRow | null> {
  const { data, error } = await serviceClient()
    .from("analyst_reports")
    .select(ANALYST_COLUMNS)
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latestAnalystReport: ${error.message}`);
  return data ? toAnalystRow(data) : null;
}

export async function recentAnalystRuns(limit = 14): Promise<AnalystRow[]> {
  const { data, error } = await serviceClient()
    .from("analyst_reports")
    .select(ANALYST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentAnalystRuns: ${error.message}`);
  return (data ?? []).map(toAnalystRow);
}

// ---------------------------------------------------------------------------
// Growth over time
// ---------------------------------------------------------------------------

/**
 * Everything the growth page can draw, and where each one comes from.
 *
 * The `kind` is load bearing rather than cosmetic. A counter reports a running
 * total and its growth is a difference; an event describes one period already
 * and its growth is a sum. Applying the wrong arithmetic to either produces a
 * number that looks reasonable and is not, so the reducer is chosen from this
 * table rather than from anything at the call site.
 */
export const GROWTH_SERIES = {
  telegram: { label: "Telegram", kind: "counter", since: "2026-08-12" },
  instagram: { label: "Instagram", kind: "counter", since: "2026-08-12" },
  youtube: { label: "YouTube", kind: "counter", since: "2026-08-12" },
  iosReviews: { label: "App Store reviews", kind: "event", since: "2026-03-25" },
  playReviews: { label: "Google Play reviews", kind: "event", since: "2026-07-23" },
  iosDownloads: { label: "App Store downloads", kind: "event", since: "2025-08-12" },
  playInstalls: { label: "Google Play installs", kind: "counter", since: "2026-08-12" },
} as const;

export type GrowthSeriesKey = keyof typeof GROWTH_SERIES;

export interface GrowthSeries {
  key: GrowthSeriesKey;
  label: string;
  points: GrowthPoint[];
}

/** Follower readings for one platform, oldest first. */
async function socialReadings(platform: string): Promise<Reading[]> {
  const rows = await fetchAllPages<{ checked_at: string | null; captured_at: string; followers: number }>(
    (from, to) =>
      serviceClient()
        .from("social_snapshots")
        .select("checked_at, captured_at, followers")
        .eq("platform", platform)
        .order("captured_at", { ascending: true })
        .range(from, to),
    `socialReadings(${platform})`,
  );

  // checked_at is when we actually reached the platform; captured_at is only
  // the hour it is filed under. The real time is the one that decides which
  // day a reading belongs to.
  return rows.map((row) => ({ at: row.checked_at ?? row.captured_at, value: row.followers }));
}

/** Review timestamps for one platform. */
async function reviewTimestamps(platform: "ios" | "android"): Promise<string[]> {
  const rows = await fetchAllPages<{ submitted_at: string | null }>(
    (from, to) =>
      serviceClient()
        .from("reviews")
        .select("submitted_at, apps!inner(platform, role)")
        .eq("apps.platform", platform)
        // Competitor reviews are not collected, so this cannot leak today. It
        // is here so that it still cannot if they ever are.
        .eq("apps.role", "own")
        .not("submitted_at", "is", null)
        .order("submitted_at", { ascending: true })
        .range(from, to),
    `reviewTimestamps(${platform})`,
  );

  return rows.map((row) => row.submitted_at).filter((at): at is string => at !== null);
}

/**
 * One series, bucketed.
 *
 * Reduction happens here in JavaScript rather than in SQL because PostgREST
 * cannot group without a stored function, and because the bucketing rules are
 * worth testing without a database attached. The volumes are small: a year of
 * daily download rows is the largest of these and it pages cleanly.
 */
export async function growthSeries(
  key: GrowthSeriesKey,
  period: Period,
): Promise<GrowthSeries> {
  const spec = GROWTH_SERIES[key];
  const points = await growthPoints(key, period);
  return { key, label: spec.label, points };
}

async function growthPoints(key: GrowthSeriesKey, period: Period): Promise<GrowthPoint[]> {
  if (key === "telegram" || key === "instagram" || key === "youtube") {
    return netChangeByBucket(await socialReadings(key), period);
  }

  if (key === "iosReviews") return countByBucket(await reviewTimestamps("ios"), period);
  if (key === "playReviews") return countByBucket(await reviewTimestamps("android"), period);

  if (key === "iosDownloads") {
    const id = await appId("ios");
    if (!id) return [];

    const rows = await fetchAllPages<{ date: string; download_type: string; units: number }>(
      (from, to) =>
        serviceClient()
          .from("ios_downloads_daily")
          .select("date, download_type, units")
          .eq("app_id", id)
          .eq("source", "sales")
          .order("date", { ascending: true })
          .range(from, to),
      "growth iosDownloads",
    );

    /*
     * Updates are excluded. They are re-downloads by people who already have
     * the app, so counting them as growth would make a big release look like a
     * surge of new users. This matches what the downloads page already counts.
     *
     * Apple dates each row to its own reporting day, which is not the Tashkent
     * day used elsewhere on this page. Noon is used as the timestamp so that
     * converting to a local date cannot shift the row into a neighbouring day.
     */
    return sumByBucket(
      rows
        .filter((row) => row.download_type !== "update")
        .map((row) => ({ at: `${row.date}T12:00:00Z`, amount: row.units })),
      period,
    );
  }

  // playInstalls: a cumulative counter, same as followers.
  const id = await appId("android");
  if (!id) return [];

  const rows = await fetchAllPages<{ captured_at: string; install_count: number | null }>(
    (from, to) =>
      serviceClient()
        .from("metric_snapshots")
        .select("captured_at, install_count")
        .eq("app_id", id)
        .eq("country", "uz")
        .not("install_count", "is", null)
        .order("captured_at", { ascending: true })
        .range(from, to),
    "growth playInstalls",
  );

  return netChangeByBucket(
    rows.map((row) => ({ at: row.captured_at, value: row.install_count as number })),
    period,
  );
}

export interface DiscoveryFunnel {
  impressions: number;
  /** Somebody tapped the listing in search or browse. */
  taps: number;
  pageViews: number;
  firstTimeDownloads: number;
  /** The dates actually covered, so the UI can say what window this is. */
  from: string;
  to: string;
}

/**
 * Impressions, product page views and first-time downloads over one window.
 *
 * The window is taken from the discovery rows and then applied to the download
 * rows, rather than both being asked for "the last 30 days" independently. The
 * two reports do not land at the same time, so a fixed window would routinely
 * compare a complete set of impressions against a downloads set missing its
 * most recent day, and quietly understate conversion.
 *
 * Downloads come from the analytics rows rather than sales for the same
 * reason: those are the ones that share Apple's analytics processing schedule.
 */
export async function iosDiscoveryFunnel(days = 30): Promise<DiscoveryFunnel | null> {
  const id = await appId("ios");
  if (!id) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Paged: one row per country per event per page type per source per device
  // passes a thousand rows quickly. See the PostgREST note at the top.
  const discovery = await fetchAllPages<{ date: string; event: string; units: number }>(
    (from, to) =>
      serviceClient()
        .from("ios_discovery_daily")
        .select("date, event, units")
        .eq("app_id", id)
        .gte("date", since)
        .order("date", { ascending: true })
        .range(from, to),
    "iosDiscoveryFunnel",
  );

  if (discovery.length === 0) return null;

  const dates = discovery.map((row) => row.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  let impressions = 0;
  let taps = 0;
  let pageViews = 0;
  for (const row of discovery) {
    if (IMPRESSION_EVENTS.includes(row.event)) impressions += row.units;
    else if (TAP_EVENTS.includes(row.event)) taps += row.units;
    else if (PAGE_VIEW_EVENTS.includes(row.event)) pageViews += row.units;
  }

  const downloads = await fetchAllPages<{ units: number }>(
    (rangeFrom, rangeTo) =>
      serviceClient()
        .from("ios_downloads_daily")
        .select("units")
        .eq("app_id", id)
        .eq("source", "analytics")
        .eq("download_type", "first_time")
        .gte("date", from)
        .lte("date", to)
        .range(rangeFrom, rangeTo),
    "iosDiscoveryFunnel downloads",
  );

  return {
    impressions,
    taps,
    pageViews,
    firstTimeDownloads: downloads.reduce((total, row) => total + row.units, 0),
    from,
    to,
  };
}

export interface FollowerPoint {
  /** When the platform was actually reached, not the hour it is filed under. */
  at: string;
  followers: number;
}

/**
 * Every follower reading for one platform, oldest first.
 *
 * Keyed on checked_at rather than captured_at for the same reason socialTrends
 * is: captured_at is the hour a reading is filed under, and at a one-minute
 * pulse those differ enough to put a reading on the wrong side of a day
 * boundary.
 *
 * Returned raw rather than bucketed. The drill-down draws the actual line of
 * what we observed, and a daily reduction would hide the flat stretches where
 * a platform stopped answering, which is exactly what the page needs to show.
 */
export async function followerHistory(
  platform: string,
  days = 90,
): Promise<FollowerPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await fetchAllPages<{
    checked_at: string | null;
    captured_at: string;
    followers: number;
  }>(
    (from, to) =>
      serviceClient()
        .from("social_snapshots")
        .select("checked_at, captured_at, followers")
        .eq("platform", platform)
        .gte("captured_at", since)
        .order("captured_at", { ascending: true })
        .range(from, to),
    `followerHistory(${platform})`,
  );

  return rows.map((row) => ({
    at: row.checked_at ?? row.captured_at,
    followers: row.followers,
  }));
}

// ---------------------------------------------------------------------------
// Active users, pushed from the app backend
// ---------------------------------------------------------------------------

export interface ActiveUsers {
  date: string;
  dau: number;
  wau: number;
  mau: number;
  /** DAU as a share of MAU, or null without a denominator. */
  stickiness: number | null;
  /** Windowed comparisons, each naming the span it really measured. */
  dauPrevious: number | null;
  dauSpanDays: number | null;
  mauPrevious: number | null;
  mauSpanDays: number | null;
  /** When the push arrived, so a stalled sender is visible. */
  receivedAt: string;
  /** Days between the newest row's date and today in Tashkent. */
  daysBehind: number;
}

/**
 * The newest active-user reading, with movement.
 *
 * Reads the combined 'all' rows only. Per-platform rows are optional extras
 * the backend may or may not send, and mixing them into the headline would
 * double-count the moment they arrive.
 *
 * daysBehind exists because this is the one series we do not collect: if their
 * job stops, the numbers simply stop moving, and a dashboard that shows a
 * three-day-old DAU as though it were today's is the failure mode to avoid.
 */
export async function activeUsersTrend(days = 60): Promise<ActiveUsers | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await serviceClient()
    .from("active_users_daily")
    .select("date, dau, wau, mau, received_at")
    .eq("platform", "all")
    .gte("date", since)
    .order("date", { ascending: false });

  if (error) throw new Error(`activeUsersTrend: ${error.message}`);

  const rows = (data ?? []) as {
    date: string;
    dau: number;
    wau: number;
    mau: number;
    received_at: string;
  }[];
  if (rows.length === 0) return null;

  const latest = rows[0];

  // priorWithinWindow works on timestamps; these rows are whole days, so the
  // date is anchored at midnight to compare on the same footing as everything
  // else on the dashboard.
  const asReadings = (pick: (row: typeof latest) => number) =>
    rows.map((row) => ({ capturedAt: `${row.date}T00:00:00Z`, value: pick(row) }));

  const dauPrior = priorWithinWindow(asReadings((row) => row.dau), weekAgoIso());
  const mauPrior = priorWithinWindow(asReadings((row) => row.mau), weekAgoIso());

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const daysBehind = Math.max(
    0,
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest.date}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000),
    ),
  );

  return {
    date: latest.date,
    dau: latest.dau,
    wau: latest.wau,
    mau: latest.mau,
    stickiness: stickiness(latest.dau, latest.mau),
    dauPrevious: dauPrior?.value ?? null,
    dauSpanDays: dauPrior?.spanDays ?? null,
    mauPrevious: mauPrior?.value ?? null,
    mauSpanDays: mauPrior?.spanDays ?? null,
    receivedAt: latest.received_at,
    daysBehind,
  };
}

// ---------------------------------------------------------------------------
// UstozAI's own product and business metrics
// ---------------------------------------------------------------------------

export interface RevenueDay {
  date: string;
  amount: number;
  transactions: number;
}

export interface RevenueSummary {
  /** The most recent day with any takings, and what they were. */
  latest: RevenueDay | null;
  /** Day totals oldest first, for the chart. */
  daily: RevenueDay[];
  /** Takings per provider over the window, largest first. */
  byProvider: { provider: string; amount: number; transactions: number }[];
  /** Movement of the daily total, with the span it really measured. */
  previous: number | null;
  spanDays: number | null;
  /** Sum over the whole window, which is what a month-to-date figure is. */
  windowTotal: number;
}

/**
 * Tiyin to som. Payme and Click both report in tiyin, the hundredth of a som,
 * which the company confirmed rather than us inferring it from the size of the
 * number. The column keeps the raw API value; this is the only place the scale
 * is applied, so every consumer gets som without having to know that.
 *
 * Totals are summed in tiyin and converted once. Dividing each row first and
 * adding the results would let a window total collect a float tail from a
 * hundred separate divisions.
 */
const TIYIN_PER_SOM = 100;
const toSom = (tiyin: number) => tiyin / TIYIN_PER_SOM;

/**
 * Takings per day and per payment provider, in som.
 *
 * The 'ALL' rows are the API's own day totals rather than a sum of the
 * providers, so the two can be compared instead of assumed equal.
 */
export async function revenueSummary(days = 30): Promise<RevenueSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await serviceClient()
    .from("revenue_daily")
    .select("date, provider, amount, transactions")
    .gte("date", since)
    .order("date", { ascending: true });
  if (error) throw new Error(`revenueSummary: ${error.message}`);

  return summariseRevenue((data ?? []) as RevenueRow[], weekAgoIso());
}

/** A row of revenue_daily, in tiyin, as it comes back from the database. */
export interface RevenueRow {
  date: string;
  provider: string;
  amount: number;
  transactions: number;
}

/**
 * The tiyin-to-som arithmetic, kept separate from the fetch so it can be tested
 * without a database. This is where the hundredfold lives, and a hundredfold
 * error here is the most quotable number in the company being wrong.
 */
export function summariseRevenue(rows: RevenueRow[], weekAgo: string): RevenueSummary {
  const dayRows = rows.filter((row) => row.provider === "ALL");

  const daily = dayRows.map((row) => ({
    date: row.date,
    amount: toSom(Number(row.amount)),
    transactions: row.transactions,
  }));

  // Accumulated in tiyin; converted once when the array is built below.
  const providers = new Map<string, { amount: number; transactions: number }>();
  for (const row of rows) {
    if (row.provider === "ALL") continue;
    const entry = providers.get(row.provider) ?? { amount: 0, transactions: 0 };
    entry.amount += Number(row.amount);
    entry.transactions += row.transactions;
    providers.set(row.provider, entry);
  }

  const prior = priorWithinWindow(
    daily.map((day) => ({ capturedAt: `${day.date}T00:00:00Z`, value: day.amount })),
    weekAgo,
  );

  return {
    latest: daily.at(-1) ?? null,
    daily,
    byProvider: [...providers.entries()]
      .map(([provider, totals]) => ({ ...totals, provider, amount: toSom(totals.amount) }))
      .sort((a, b) => b.amount - a.amount),
    previous: prior?.value ?? null,
    spanDays: prior?.spanDays ?? null,
    windowTotal: toSom(dayRows.reduce((sum, row) => sum + Number(row.amount), 0)),
  };
}

export interface EngagementSummary {
  date: string;
  views: number | null;
  totalLogins: number | null;
  averageMinutes: number | null;
  viewsPrevious: number | null;
  viewsSpanDays: number | null;
  /** Views per day over the window, oldest first. */
  daily: { date: string; views: number }[];
}

/**
 * Views, logins and session length.
 *
 * Views are deliberately not called active users. The API document labels
 * this endpoint the DAU chart and it returns a figure roughly twenty-five
 * times larger, so the two are kept under names that cannot be confused.
 */
export async function engagementSummary(days = 30): Promise<EngagementSummary | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await serviceClient()
    .from("app_engagement_daily")
    .select("date, views, total_logins, average_minutes")
    .gte("date", since)
    .order("date", { ascending: true });
  if (error) throw new Error(`engagementSummary: ${error.message}`);

  const rows = (data ?? []) as {
    date: string;
    views: number | null;
    total_logins: number | null;
    average_minutes: string | number | null;
  }[];
  if (rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  const daily = rows
    .filter((row) => row.views !== null)
    .map((row) => ({ date: row.date, views: row.views as number }));

  const prior = priorWithinWindow(
    daily.map((row) => ({ capturedAt: `${row.date}T00:00:00Z`, value: row.views })),
    weekAgoIso(),
  );

  // The most recent day that actually carries a session length, since the
  // visit summary is attributed to the end of each collection window.
  const withMinutes = [...rows].reverse().find((row) => row.average_minutes !== null);

  return {
    date: latest.date,
    views: latest.views,
    totalLogins: withMinutes?.total_logins ?? null,
    averageMinutes:
      withMinutes?.average_minutes === null || withMinutes?.average_minutes === undefined
        ? null
        : Number(withMinutes.average_minutes),
    viewsPrevious: prior?.value ?? null,
    viewsSpanDays: prior?.spanDays ?? null,
    daily,
  };
}

export async function latestPlatformCheck(platform: string): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("social_snapshots")
    .select("checked_at")
    .eq("platform", platform)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`latestPlatformCheck(${platform}): ${error.message}`);
  return data?.checked_at ?? null;
}

export async function latestAudienceCheck(): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("social_snapshots")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`latestAudienceCheck: ${error.message}`);
  return data?.checked_at ?? null;
}

export interface SourceHealth {
  source: string;
  status: string;
  ranAt: string;
  error: string | null;
}

/**
 * Most recent run per source. Drives the freshness badge on every panel, which
 * is the only thing standing between a broken undocumented feed and a chart
 * that looks fine while quietly reporting nothing.
 */
export async function collectorHealth(): Promise<SourceHealth[]> {
  const { data, error } = await serviceClient()
    .from("collector_runs")
    .select("source, status, ran_at, error")
    .order("ran_at", { ascending: false })
    .limit(400);

  if (error) throw new Error(`collectorHealth: ${error.message}`);

  const latest = new Map<string, SourceHealth>();
  for (const row of data ?? []) {
    const source = row.source as string;
    if (latest.has(source)) continue;
    latest.set(source, {
      source,
      status: row.status as string,
      ranAt: row.ran_at as string,
      error: row.error as string | null,
    });
  }
  return [...latest.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** True before the first cron run, so the UI shows onboarding not zeroes. */
export async function hasAnyData(): Promise<boolean> {
  const { count, error } = await serviceClient()
    .from("metric_snapshots")
    .select("id", { count: "exact", head: true });
  if (error) return false;
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Instagram insights
// ---------------------------------------------------------------------------

/**
 * One day of the account's own performance.
 *
 * reach stands apart from the rest of these figures: it counts unique
 * accounts within its window, so it can be charted per day but never added
 * up. The column comment in 0015 carries the measured size of that error.
 */
export interface InstagramDay {
  date: string;
  reach: number | null;
  views: number | null;
  newFollowers: number | null;
  totalInteractions: number | null;
  profileViews: number | null;
}

export interface InstagramPerformance {
  /** Oldest first, ready to chart. */
  daily: InstagramDay[];
  latest: InstagramDay | null;
  /**
   * Sums over the window, for the additive metrics only.
   *
   * There is deliberately no windowReach. Adding seven days of reach
   * double-counts everyone who saw the account on more than one of them:
   * measured against Instagram's own weekly figure, the sum overstated it by
   * a tenth. A window reach can only be read from the API for that window,
   * and we hold no such reading, so the page reports the best single day
   * rather than implying a total nothing here supports.
   */
  windowViews: number | null;
  windowInteractions: number | null;
  windowNewFollowers: number | null;
  /** The same sums over the window before this one, for a comparison. */
  previousViews: number | null;
  previousInteractions: number | null;
  bestReachDay: InstagramDay | null;
  spanDays: number;
}

const sumOrNull = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
};

export async function instagramPerformance(days = 90): Promise<InstagramPerformance> {
  // Both windows are fetched together so the comparison needs no second round
  // trip, and so a half-collected older window shows up as a gap rather than
  // being read as a fall.
  const since = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await fetchAllPages<{
    date: string;
    reach: number | null;
    views: number | null;
    new_followers: number | null;
    total_interactions: number | null;
    profile_views: number | null;
  }>(
    (from, to) =>
      serviceClient()
        .from("instagram_daily")
        .select("date, reach, views, new_followers, total_interactions, profile_views")
        .gte("date", since)
        .order("date", { ascending: true })
        .range(from, to),
    "instagramPerformance",
  );

  const all: InstagramDay[] = rows.map((row) => ({
    date: row.date,
    reach: row.reach,
    views: row.views,
    newFollowers: row.new_followers,
    totalInteractions: row.total_interactions,
    profileViews: row.profile_views,
  }));

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const daily = all.filter((day) => day.date >= cutoff);
  const previous = all.filter((day) => day.date < cutoff);

  const withReach = daily.filter((day) => day.reach !== null);
  const bestReachDay =
    withReach.length === 0
      ? null
      : withReach.reduce((best, day) => ((day.reach ?? 0) > (best.reach ?? 0) ? day : best));

  return {
    daily,
    latest: daily.at(-1) ?? null,
    windowViews: sumOrNull(daily.map((day) => day.views)),
    windowInteractions: sumOrNull(daily.map((day) => day.totalInteractions)),
    windowNewFollowers: sumOrNull(daily.map((day) => day.newFollowers)),
    previousViews: sumOrNull(previous.map((day) => day.views)),
    previousInteractions: sumOrNull(previous.map((day) => day.totalInteractions)),
    bestReachDay,
    spanDays: days,
  };
}

export interface InstagramTopPost {
  mediaId: string;
  postedAt: string;
  mediaProductType: string;
  mediaType: string;
  caption: string | null;
  permalink: string | null;
  reach: number | null;
  views: number | null;
  totalInteractions: number | null;
  saved: number | null;
  shares: number | null;
  avgWatchTimeMs: number | null;
  /** Interactions per account reached. Null when either side is missing. */
  engagementRate: number | null;
}

/**
 * The posts that travelled furthest.
 *
 * Ranked on reach rather than likes. Reach is what a post actually bought,
 * whereas likes track audience size more than they track whether the post
 * worked.
 *
 * These are lifetime counters, so a post from March has had months to
 * accumulate what a post from yesterday has not. Restricting the ranking to
 * posts published inside the window is what keeps that comparison fair.
 */
export async function instagramTopPosts(days = 90, limit = 10): Promise<InstagramTopPost[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient()
    .from("instagram_posts")
    .select(
      "media_id, posted_at, media_product_type, media_type, caption, permalink, reach, views, total_interactions, saved, shares, avg_watch_time_ms",
    )
    .gte("posted_at", since)
    .order("reach", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`instagramTopPosts: ${error.message}`);

  return (data ?? []).map((row) => {
    const reach = row.reach as number | null;
    const interactions = row.total_interactions as number | null;
    return {
      mediaId: row.media_id as string,
      postedAt: row.posted_at as string,
      mediaProductType: row.media_product_type as string,
      mediaType: row.media_type as string,
      caption: row.caption as string | null,
      permalink: row.permalink as string | null,
      reach,
      views: row.views as number | null,
      totalInteractions: interactions,
      saved: row.saved as number | null,
      shares: row.shares as number | null,
      avgWatchTimeMs: row.avg_watch_time_ms as number | null,
      engagementRate:
        reach !== null && reach > 0 && interactions !== null ? interactions / reach : null,
    };
  });
}

export interface InstagramAudienceBucket {
  bucket: string;
  followers: number;
}

export interface InstagramAudience {
  date: string;
  countries: InstagramAudienceBucket[];
  cities: InstagramAudienceBucket[];
  age: InstagramAudienceBucket[];
  gender: InstagramAudienceBucket[];
  /**
   * What the buckets add up to, which sits below the follower count by design.
   *
   * Instagram withholds buckets too small to report without identifying
   * people, so a share has to be quoted against this figure rather than
   * against the follower total. A chart implying the cuts cover everybody
   * would be wrong by however much Instagram declined to attribute.
   */
  attributed: number;
}

export async function instagramAudience(): Promise<InstagramAudience | null> {
  const { data: latest, error: latestError } = await serviceClient()
    .from("instagram_demographics")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);

  if (latestError) throw new Error(`instagramAudience: ${latestError.message}`);
  const date = latest?.[0]?.date as string | undefined;
  if (!date) return null;

  const rows = await fetchAllPages<{ breakdown: string; bucket: string; followers: number }>(
    (from, to) =>
      serviceClient()
        .from("instagram_demographics")
        .select("breakdown, bucket, followers")
        .eq("date", date)
        .order("followers", { ascending: false })
        .range(from, to),
    "instagramAudience",
  );

  const pick = (breakdown: string) =>
    rows
      .filter((row) => row.breakdown === breakdown)
      .map((row) => ({ bucket: row.bucket, followers: row.followers }));

  const countries = pick("country");

  return {
    date,
    countries,
    cities: pick("city"),
    age: pick("age"),
    gender: pick("gender"),
    attributed: countries.reduce((sum, row) => sum + row.followers, 0),
  };
}

export interface InstagramStoryRow {
  mediaId: string;
  postedAt: string;
  permalink: string | null;
  mediaType: string;
  reach: number | null;
  views: number | null;
  replies: number | null;
  navigation: number | null;
}

export async function instagramStories(days = 14): Promise<InstagramStoryRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient()
    .from("instagram_stories")
    .select("media_id, posted_at, permalink, media_type, reach, views, replies, navigation")
    .gte("posted_at", since)
    .order("posted_at", { ascending: false });

  if (error) throw new Error(`instagramStories: ${error.message}`);

  return (data ?? []).map((row) => ({
    mediaId: row.media_id as string,
    postedAt: row.posted_at as string,
    permalink: row.permalink as string | null,
    mediaType: row.media_type as string,
    reach: row.reach as number | null,
    views: row.views as number | null,
    replies: row.replies as number | null,
    navigation: row.navigation as number | null,
  }));
}
