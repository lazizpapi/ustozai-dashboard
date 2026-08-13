import "server-only";

import { serviceClient } from "./client";
import type {
  ChartRank,
  KeywordRank,
  MetricSnapshot,
  Platform,
  Review,
} from "@/lib/collectors/types";
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
