import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import {
  MAX_LOOKBACK_DAYS,
  fetchInstagramPosts,
  fetchInstagramSeries,
  fetchInstagramTotals,
  isoDate,
  recentPosts,
  startOfUtcDay,
} from "@/lib/collectors/instagram";
import {
  recordRuns,
  saveInstagramNewFollowers,
  saveInstagramPostMetrics,
  saveInstagramPosts,
  saveInstagramReach,
  saveInstagramTotals,
} from "@/lib/db/persist";
import { instagramToken } from "@/lib/db/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One-time backfill of Instagram history.
 *
 * Separate from the daily run for the same reasons as the iOS backfill: it
 * walks back as far as Meta will serve, sends no digest, and touches nothing
 * but the instagram_* tables, so triggering it can never double-post to
 * Telegram or disturb another series.
 *
 * The two families of metric cost wildly different amounts and are therefore
 * bounded differently. reach and follower_count come back as real series, so
 * two years costs about ten requests and is always done in full. Everything
 * else exists only as a window total, so a day is a request; that walk is
 * bounded by ?days= and defaults to ninety.
 *
 * Best run locally rather than on Vercel. A long day-walk sits uncomfortably
 * close to the 300s function ceiling and a laptop has none; it writes to the
 * same database either way. It stays deployed because it is idempotent, and
 * useful for repairing a gap after an outage.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "http://localhost:3000/api/cron/backfill-instagram?days=90"
 */

/** Meta serves a long series in one response, but not an unbounded one. */
const SERIES_CHUNK_DAYS = 180;

const DAY_MS = 86_400_000;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const token = await instagramToken();
  if (!token) {
    return Response.json(
      { ok: false, error: "No Instagram token is configured" },
      { status: 400 },
    );
  }

  const requested = Number(new URL(request.url).searchParams.get("days") ?? 90);
  const days = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LOOKBACK_DAYS)
    : 90;

  const started = Date.now();
  const access = token.accessToken;
  const today = startOfUtcDay(new Date());

  try {
    /*
     * The cheap half: two real series, walked backwards in chunks. Requested
     * whole rather than bounded by ?days= because ten requests buy the full
     * two years and there is no reason to hold any of it back.
     */
    let reachRows = 0;
    let followerRows = 0;

    for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += SERIES_CHUNK_DAYS) {
      const until = new Date(today.getTime() - offset * DAY_MS);
      const span = Math.min(SERIES_CHUNK_DAYS, MAX_LOOKBACK_DAYS - offset);
      const since = new Date(until.getTime() - span * DAY_MS);

      const [reach, followers] = await Promise.all([
        fetchInstagramSeries(access, "reach", since, until),
        fetchInstagramSeries(access, "follower_count", since, until),
      ]);

      reachRows += await saveInstagramReach(reach);
      followerRows += await saveInstagramNewFollowers(followers);
    }

    /*
     * The expensive half: one request per day.
     *
     * A day that errors is skipped rather than abandoning the walk, because
     * the alternative is that one bad day in the middle of ninety throws away
     * the eighty-nine either side of it.
     */
    let totalDays = 0;
    let failedDays = 0;

    for (let offset = 1; offset <= days; offset += 1) {
      const day = new Date(today.getTime() - offset * DAY_MS);
      try {
        const totals = await fetchInstagramTotals(access, day);
        await saveInstagramTotals([totals]);
        totalDays += 1;
      } catch {
        failedDays += 1;
      }
    }

    // Every post, in one pass. Post metrics are only seeded for the recent
    // window, since older posts have no history to reconstruct anyway.
    const posts = await fetchInstagramPosts(access);
    await saveInstagramPosts(posts);
    const sampled = await saveInstagramPostMetrics(recentPosts(posts), isoDate(today));

    await recordRuns([
      {
        source: "instagram-backfill",
        status: failedDays > 0 ? "failed" : "ok",
        records: reachRows + followerRows + totalDays + posts.length,
        error: failedDays > 0 ? `${failedDays} days errored` : undefined,
        durationMs: Date.now() - started,
      },
    ]);

    return Response.json({
      ok: true,
      requestedDays: days,
      reachRows,
      followerRows,
      totalDays,
      failedDays,
      posts: posts.length,
      postMetricRows: sampled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRuns([
      {
        source: "instagram-backfill",
        status: "failed",
        error: message,
        durationMs: Date.now() - started,
      },
    ]);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
