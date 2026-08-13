import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { collectIosDownloads, MAX_LOOKBACK_DAYS } from "@/lib/asc/collect";
import { ascConfigProblem, ascEnv } from "@/lib/env";
import { recordRuns } from "@/lib/db/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One-time backfill of historical iOS downloads.
 *
 * Separate from the daily run on purpose: it walks back as far as Apple will
 * serve, sends no digest, and touches nothing but ios_downloads_daily, so
 * triggering it can never double-post to Telegram or disturb the other series.
 *
 * Best run locally rather than on Vercel. A long walk plus download time sits
 * uncomfortably close to the 300s function ceiling, and there is no ceiling on
 * a laptop; it writes to the same database either way. It stays deployed
 * because it is idempotent, and useful for repairing a gap after any outage.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "http://localhost:3000/api/cron/backfill?days=420"
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const config = ascEnv();
  if (!config) {
    return Response.json(
      { ok: false, error: ascConfigProblem() ?? "App Store Connect is not configured" },
      { status: 400 },
    );
  }

  const requested = Number(new URL(request.url).searchParams.get("days") ?? 90);
  const days = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LOOKBACK_DAYS)
    : 90;

  const started = Date.now();
  try {
    const summary = await collectIosDownloads(config, {
      lookbackDays: days,
      tolerateDayFailures: true,
    });

    // Hitting Apple's 365-day retention edge is a normal outcome and is not
    // counted here. Only genuine per-day errors mark the run failed; anything
    // else would leave a permanent false alarm in the health panel.
    await recordRuns([
      {
        source: "asc-backfill",
        status: summary.daysFailed > 0 ? "failed" : "ok",
        records: summary.rows,
        error: summary.daysFailed > 0 ? `${summary.daysFailed} days errored` : undefined,
        durationMs: Date.now() - started,
      },
    ]);

    return Response.json({ ok: true, requestedDays: days, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRuns([
      { source: "asc-backfill", status: "failed", error: message, durationMs: Date.now() - started },
    ]);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
