import "server-only";

import { serviceClient } from "./client";
import { localDate } from "@/lib/growth";
import type {
  ChartApp,
  ChartRank,
  KeywordRank,
  MetricSnapshot,
  Platform,
  Review,
} from "@/lib/collectors/types";
import type { ListingRecord } from "@/lib/collectors/listing";
import type { SocialSnapshot } from "@/lib/collectors/social";

/**
 * Every database write in the application lives here.
 *
 * Collectors stay pure and return plain records; this module is the only place
 * that knows Supabase exists. That separation is what makes the parsers
 * testable against fixtures with no network and no database.
 *
 * All writes are upserts keyed on the same unique constraints declared in
 * 0001_init.sql, so re-running a cron hour corrects rows instead of duplicating
 * them.
 */

/**
 * Truncate to the hour so every row written by one cron run shares a timestamp
 * and a rerun of that hour lands on the same unique key.
 */
export function hourBucket(when: Date = new Date()): string {
  const bucket = new Date(when);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

type AppKey = `${Platform}:${string}`;

/**
 * Cache the in-flight promise, not just the resolved value.
 *
 * Caching only the result leaves a window where concurrent callers all miss and
 * each fire their own query. The save functions run under Promise.allSettled,
 * so that window is hit on every single run: the first poll against a live
 * database issued two simultaneous lookups and one of them failed, losing that
 * run's chart ranks while the snapshots written by the other survived.
 *
 * Holding the promise makes concurrent callers share one request. The cache is
 * cleared on failure so a transient error does not poison every later call.
 */
let appIdCache: Promise<Map<AppKey, string>> | null = null;

export async function resolveAppIds(): Promise<Map<AppKey, string>> {
  appIdCache ??= (async () => {
    const { data, error } = await serviceClient()
      .from("apps")
      .select("id, platform, store_id");
    if (error) throw new Error(`could not load apps: ${error.message}`);

    return new Map(
      (data ?? []).map((row) => [
        `${row.platform}:${row.store_id}` as AppKey,
        row.id as string,
      ]),
    );
  })();

  try {
    return await appIdCache;
  } catch (error) {
    appIdCache = null;
    throw error;
  }
}

function appIdFor(ids: Map<AppKey, string>, platform: Platform, storeId: string): string {
  const id = ids.get(`${platform}:${storeId}`);
  if (!id) throw new Error(`no apps row for ${platform}:${storeId}; run the seed migration`);
  return id;
}

/**
 * The app map, re-read once if a key is missing.
 *
 * appIdCache is held for the life of the instance, which is right almost
 * always and wrong exactly when a new app row is added: a warm instance keeps
 * the map it resolved before the row existed and rejects every write for that
 * app until it happens to recycle, which can be hours. Since a miss is the only
 * symptom, a miss is what triggers the re-read.
 *
 * Still throws when the row genuinely is not there, so a competitor listed in
 * config but never seeded is a loud failure rather than a silent gap.
 */
async function resolveAppIdsIncluding(
  keys: readonly { platform: Platform; storeId: string }[],
): Promise<Map<AppKey, string>> {
  const ids = await resolveAppIds();
  const missing = keys.some((key) => !ids.has(`${key.platform}:${key.storeId}`));
  if (!missing) return ids;

  appIdCache = null;
  return resolveAppIds();
}

export async function saveSnapshots(
  snapshots: MetricSnapshot[],
  capturedAt: string,
): Promise<number> {
  if (snapshots.length === 0) return 0;
  const ids = await resolveAppIdsIncluding(snapshots);

  const rows = snapshots.map((snapshot) => ({
    app_id: appIdFor(ids, snapshot.platform, snapshot.storeId),
    country: snapshot.country,
    captured_at: capturedAt,
    rating: snapshot.rating,
    rating_count: snapshot.ratingCount,
    install_count: snapshot.installCount,
    install_label: snapshot.installLabel,
    version: snapshot.version,
  }));

  const { error } = await serviceClient()
    .from("metric_snapshots")
    .upsert(rows, { onConflict: "app_id,country,captured_at" });
  if (error) throw new Error(`saveSnapshots: ${error.message}`);
  return rows.length;
}

export async function saveChartRanks(
  ranks: ChartRank[],
  capturedAt: string,
): Promise<number> {
  if (ranks.length === 0) return 0;
  const ids = await resolveAppIdsIncluding(ranks);

  const rows = ranks.map((rank) => ({
    app_id: appIdFor(ids, rank.platform, rank.storeId),
    country: rank.country,
    chart_type: rank.chartType,
    genre: rank.genre,
    // Kept as-is: null here means "polled fine, outside the feed", which the
    // charts must render differently from a gap caused by a failed poll.
    rank: rank.rank,
    feed_size: rank.feedSize,
    captured_at: capturedAt,
  }));

  const { error } = await serviceClient()
    .from("chart_ranks")
    .upsert(rows, { onConflict: "app_id,country,chart_type,genre,captured_at" });
  if (error) throw new Error(`saveChartRanks: ${error.message}`);
  return rows.length;
}

/**
 * The visible top of each chart, one row per position per Tashkent day.
 *
 * Upserted hourly onto the same (chart, date, rank) key, so the day's rows are
 * always the newest reading and settle into the day's final state at midnight.
 * No app_id resolution: most of the chart is apps we do not track.
 */
export async function saveChartApps(
  apps: ChartApp[],
  capturedAt: string,
): Promise<number> {
  if (apps.length === 0) return 0;

  const date = localDate(capturedAt);
  const rows = apps.map((app) => ({
    country: app.country,
    chart_type: app.chartType,
    genre: app.genre,
    date,
    rank: app.rank,
    store_id: app.storeId,
    name: app.name,
    // Explicit rather than a column default: defaults do not apply on
    // conflict, and a same-day upsert must refresh the timestamp.
    captured_at: capturedAt,
  }));

  const { error } = await serviceClient()
    .from("chart_apps")
    .upsert(rows, { onConflict: "country,chart_type,genre,date,rank" });
  if (error) throw new Error(`saveChartApps: ${error.message}`);
  return rows.length;
}

/**
 * Listing versions, written only when the content hash moved.
 *
 * The comparison is against the newest stored hash per app, so re-running an
 * hour is a no-op and a flapping source would still write at most one row per
 * actual change of state.
 */
export async function saveListings(listings: ListingRecord[]): Promise<number> {
  if (listings.length === 0) return 0;
  const ids = await resolveAppIdsIncluding(listings);

  const appIds = listings.map((listing) =>
    appIdFor(ids, listing.platform, listing.storeId),
  );

  const { data, error } = await serviceClient()
    .from("listing_versions")
    .select("app_id, content_hash, detected_at")
    .in("app_id", appIds)
    .order("detected_at", { ascending: false });
  if (error) throw new Error(`saveListings read: ${error.message}`);

  // Newest hash per app; the query is ordered, so first sighting wins.
  const latest = new Map<string, string>();
  for (const row of data ?? []) {
    if (!latest.has(row.app_id as string)) {
      latest.set(row.app_id as string, row.content_hash as string);
    }
  }

  const rows = listings.flatMap((listing, index) => {
    const appId = appIds[index];
    if (latest.get(appId) === listing.contentHash) return [];
    return [{ app_id: appId, fields: listing.fields, content_hash: listing.contentHash }];
  });

  if (rows.length === 0) return 0;

  const { error: insertError } = await serviceClient()
    .from("listing_versions")
    .insert(rows);
  if (insertError) throw new Error(`saveListings write: ${insertError.message}`);
  return rows.length;
}

export async function saveKeywordRanks(
  ranks: KeywordRank[],
  capturedAt: string,
): Promise<number> {
  if (ranks.length === 0) return 0;
  const ids = await resolveAppIds();

  const rows = ranks.map((rank) => ({
    app_id: appIdFor(ids, rank.platform, rank.storeId),
    country: rank.country,
    keyword: rank.keyword,
    position: rank.position,
    result_count: rank.resultCount,
    captured_at: capturedAt,
  }));

  const { error } = await serviceClient()
    .from("keyword_ranks")
    .upsert(rows, { onConflict: "app_id,country,keyword,captured_at" });
  if (error) throw new Error(`saveKeywordRanks: ${error.message}`);
  return rows.length;
}

export interface SuggestionBatch {
  platform: Platform;
  seed: string;
  terms: string[];
}

/**
 * Search suggestions, one row per term per crawl day.
 *
 * Upserted on the primary key so a re-run corrects the day. A batch with no
 * terms writes nothing, which matters for trending: Apple answers with an
 * empty list for UZ today, and an empty crawl must not erase the record of a
 * day when the list had content.
 */
export async function saveSuggestions(
  batches: SuggestionBatch[],
  capturedAt: string,
): Promise<number> {
  const date = localDate(capturedAt);
  const rows = batches.flatMap((batch) =>
    batch.terms.map((term, index) => ({
      platform: batch.platform,
      seed: batch.seed,
      date,
      position: index + 1,
      term,
      captured_at: capturedAt,
    })),
  );
  if (rows.length === 0) return 0;

  const { error } = await serviceClient()
    .from("keyword_suggestions")
    .upsert(rows, { onConflict: "platform,seed,date,position" });
  if (error) throw new Error(`saveSuggestions: ${error.message}`);
  return rows.length;
}

/**
 * Reviews are insert-only and deduplicated on the store's own review id, which
 * is why an intermittently empty feed costs nothing: the next successful poll
 * backfills whatever the flake skipped.
 */
export async function saveReviews(reviews: Review[]): Promise<number> {
  if (reviews.length === 0) return 0;
  const ids = await resolveAppIds();

  const rows = reviews.map((review) => ({
    app_id: appIdFor(ids, review.platform, review.storeId),
    country: review.country,
    store_review_id: review.storeReviewId,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author: review.author,
    version: review.version,
    submitted_at: review.submittedAt,
  }));

  const { data, error } = await serviceClient()
    .from("reviews")
    .upsert(rows, { onConflict: "app_id,store_review_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`saveReviews: ${error.message}`);

  // With ignoreDuplicates the returned rows are the genuinely new ones, which
  // is exactly what the digest wants to report.
  return data?.length ?? 0;
}

/**
 * Audience counts. Not tied to the apps table: these follow accounts, not app
 * listings, and a channel can outlive or precede any particular app.
 */
export async function saveSocialSnapshots(
  snapshots: SocialSnapshot[],
  capturedAt: string,
): Promise<number> {
  if (snapshots.length === 0) return 0;

  /*
   * checked_at is set explicitly rather than left to its column default,
   * because on a conflict the default does not apply and the row would keep
   * the timestamp of the first read of that hour. Repolling within the hour is
   * now the normal case, so that would report a number as up to an hour older
   * than it is and the staleness badge would be lying by exactly the amount
   * that matters.
   */
  const checkedAt = new Date().toISOString();

  const rows = snapshots.map((snapshot) => ({
    platform: snapshot.platform,
    handle: snapshot.handle,
    followers: snapshot.followers,
    is_exact: snapshot.isExact,
    captured_at: capturedAt,
    checked_at: checkedAt,
  }));

  const { error } = await serviceClient()
    .from("social_snapshots")
    .upsert(rows, { onConflict: "platform,captured_at" });
  if (error) throw new Error(`saveSocialSnapshots: ${error.message}`);
  return rows.length;
}

export interface RunOutcome {
  source: string;
  status: "ok" | "failed" | "skipped";
  records?: number;
  error?: string;
  durationMs?: number;
}

export async function recordRuns(outcomes: RunOutcome[]): Promise<void> {
  if (outcomes.length === 0) return;

  const { error } = await serviceClient().from("collector_runs").insert(
    outcomes.map((outcome) => ({
      source: outcome.source,
      status: outcome.status,
      records: outcome.records ?? 0,
      // Truncated: Postgres will happily store a megabyte stack trace and the
      // health panel only ever shows the first line.
      error: outcome.error?.slice(0, 2000) ?? null,
      duration_ms: outcome.durationMs ?? null,
    })),
  );
  // A failure to log a failure must not mask the original failure.
  if (error) console.error("could not record collector runs:", error.message);
}

// ---------------------------------------------------------------------------
// UstozAI's own product and business metrics
// ---------------------------------------------------------------------------

/**
 * Daily and monthly active users, from the admin API.
 *
 * MAU is a monthly figure, so every day inside a month carries that month's
 * value. That is what makes a DAU/MAU stickiness ratio computable per day
 * without joining across tables, and it is how the figure is read anyway:
 * "of the people active this month, how many came back today".
 */
export async function saveActiveUsers(
  dau: { date: string; count: number }[],
  mau: { month: string | null; count: number }[],
): Promise<number> {
  if (dau.length === 0) return 0;

  /*
   * mauStats is parsed and deliberately not stored, because measurement shows
   * it is not monthly active users.
   *
   * Its value changes with the window you ask over: August came back as 9,096
   * for a one-day range, 61,794 for a week and 88,700 for nine months. And
   * the nine-month figure exceeds the sum of that month's daily actives
   * (47,164), which distinct monthly users cannot do.
   *
   * DAU has no such problem: 2026-08-15 returns 3,577 whichever window is
   * requested. So the daily figure is trustworthy and the monthly one is not,
   * and a column called mau holding a number nobody can define is worse than
   * an empty one. Restore this once the backend team says what it counts.
   */
  void mau;

  const rows = dau.map((point) => ({
    date: point.date,
    platform: "all",
    dau: point.count,
    // No weekly bucket exists upstream. Null says so; zero would claim a week
    // in which nobody opened the app.
    wau: null,
    mau: null,
    received_at: new Date().toISOString(),
  }));

  const { error } = await serviceClient()
    .from("active_users_daily")
    .upsert(rows, { onConflict: "date,platform" });
  if (error) throw new Error(`saveActiveUsers: ${error.message}`);
  return rows.length;
}

/**
 * Views, logins and average session length.
 *
 * Each field is written only when present, so a day that already has views
 * does not lose them because the visit-summary call failed on a later run.
 */
export async function saveEngagement(
  rows: {
    date: string;
    views?: number | null;
    totalLogins?: number | null;
    averageMinutes?: number | null;
  }[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const merged = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const existing = merged.get(row.date) ?? { date: row.date };
    if (row.views !== undefined && row.views !== null) existing.views = row.views;
    if (row.totalLogins !== undefined && row.totalLogins !== null) {
      existing.total_logins = row.totalLogins;
    }
    if (row.averageMinutes !== undefined && row.averageMinutes !== null) {
      existing.average_minutes = row.averageMinutes;
    }
    existing.collected_at = new Date().toISOString();
    merged.set(row.date, existing);
  }

  const { error } = await serviceClient()
    .from("app_engagement_daily")
    .upsert([...merged.values()], { onConflict: "date" });
  if (error) throw new Error(`saveEngagement: ${error.message}`);
  return merged.size;
}

/** Takings per day per provider, including the reported day total. */
export async function saveRevenue(
  rows: { date: string; provider: string; amount: number; transactions: number }[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const { error } = await serviceClient()
    .from("revenue_daily")
    .upsert(
      rows.map((row) => ({ ...row, collected_at: new Date().toISOString() })),
      { onConflict: "date,provider" },
    );
  if (error) throw new Error(`saveRevenue: ${error.message}`);
  return rows.length;
}
