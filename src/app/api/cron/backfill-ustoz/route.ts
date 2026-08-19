import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { collectUstozMetrics } from "@/lib/ustoz/collect";
import { recordRuns } from "@/lib/db/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Backfill UstozAI's own metrics as far as the API will serve.
 *
 * Separate from the iOS backfill because it touches different tables and
 * needs no App Store Connect key. Worth having permanently rather than as a
 * one-off script: these endpoints accept a date range and restate recent
 * days, so re-running it is how a gap left by any outage gets repaired.
 *
 * Idempotent. Every write is an upsert keyed on the day, so running it twice
 * changes nothing the second time.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "http://localhost:3000/api/cron/backfill-ustoz?days=250"
 */

/** The API returned daily figures back to 1 January when probed. */
const MAX_DAYS = 400;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const requested = Number(new URL(request.url).searchParams.get("days") ?? 90);
  const days = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_DAYS)
    : 90;

  const started = Date.now();
  try {
    const summary = await collectUstozMetrics(days);
    await recordRuns(summary.outcomes);

    const failures = summary.outcomes.filter((outcome) => outcome.status === "failed");
    return Response.json({
      ok: failures.length === 0,
      requestedDays: days,
      activeUsers: summary.activeUsers,
      engagementDays: summary.engagementDays,
      revenueRows: summary.revenueRows,
      durationMs: Date.now() - started,
      failures: failures.map((outcome) => `${outcome.source}: ${outcome.error}`),
      skipped: summary.outcomes
        .filter((outcome) => outcome.status === "skipped")
        .map((outcome) => `${outcome.source}: ${outcome.error}`),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRuns([
      {
        source: "ustoz-backfill",
        status: "failed",
        error: message,
        durationMs: Date.now() - started,
      },
    ]);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
