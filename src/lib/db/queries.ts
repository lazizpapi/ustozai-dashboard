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
import { latestSuggestionSets, type SeedSuggestions } from "@/lib/aso/suggestions";
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
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekAgoIso(): string {
  return new Date(Date.now() - WEEK_MS).toISOString();
}

function trend<T>(current: T | null, previous: T | null, capturedAt: string | null): Trend<T> {
  return { current, previous, capturedAt, noHistory: previous === null };
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

export async function rankHistory(
  chartType = "topfree",
  country = "uz",
  genre: string = EDUCATION_GENRE,
  days = 90,
): Promise<RankPoint[]> {
  const id = await appId("ios");
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
): Promise<Trend & { feedSize: number | null }> {
  const history = await rankHistory(chartType, country, genre, 30);
  if (history.length === 0) {
    return { ...trend<number>(null, null, null), feedSize: null };
  }

  const latest = history[history.length - 1];
  const cutoff = weekAgoIso();
  const older = [...history].reverse().find((point) => point.capturedAt <= cutoff);

  return {
    ...trend(latest.rank, older?.rank ?? null, latest.capturedAt),
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
  const cutoff = weekAgoIso();
  const older = [...history].reverse().find((row) => row.capturedAt <= cutoff);

  return {
    ...trend(latest.rating, older?.rating ?? null, latest.capturedAt),
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

  const cutoff = weekAgoIso();
  const now = Date.now();

  return SOCIAL_PLATFORMS.map((platform) => {
    // Already newest-first from the query.
    const forPlatform = rows.filter((row) => row.platform === platform);
    const latest = forPlatform[0];
    const older = forPlatform.find((row) => row.captured_at <= cutoff);

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
      ...trend(latest.followers, older?.followers ?? null, latest.captured_at),
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
  feedSize: number | null;
  iosRating: number | null;
  iosRatingCount: number | null;
  playInstalls: number | null;
  playInstallsPrevious: number | null;
  playRating: number | null;
  playRatingCount: number | null;
}

/** Newest row, and the newest at or before the cutoff, from newest-first rows. */
function latestAndPrior<T extends { captured_at: string }>(
  rows: T[],
  cutoff: string,
): { latest: T | undefined; prior: T | undefined } {
  return {
    latest: rows[0],
    prior: rows.find((row) => row.captured_at <= cutoff),
  };
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
  const cutoff = weekAgoIso();

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

    const rank = latestAndPrior(
      ranks.filter((row) => row.app_id === iosId),
      cutoff,
    );
    const ios = latestAndPrior(
      snaps.filter((row) => row.app_id === iosId && row.rating !== null),
      cutoff,
    );
    const play = latestAndPrior(
      snaps.filter((row) => row.app_id === androidId),
      cutoff,
    );

    return {
      slug: entry.slug,
      name: entry.name,
      isOurs: entry.isOurs,
      rank: rank.latest?.rank ?? null,
      rankPrevious: rank.prior?.rank ?? null,
      feedSize: rank.latest?.feed_size ?? null,
      iosRating: ios.latest?.rating ?? null,
      iosRatingCount: ios.latest?.rating_count ?? null,
      playInstalls: play.latest?.install_count ?? null,
      playInstallsPrevious: play.prior?.install_count ?? null,
      playRating: play.latest?.rating ?? null,
      playRatingCount: play.latest?.rating_count ?? null,
    };
  });
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
