import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { backfillNotes } from "@/lib/analyst/backfill-notes";
import { openaiKey } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Explain movements that already happened, so the feed does not start empty.
 *
 * The daily run only judges the newest day, which means the notes feed has
 * nothing in it until the next notable day comes along; on these numbers that
 * is about a week. Everything before is unexplained while the data that would
 * explain it is still sitting there.
 *
 * Worth keeping rather than running once and deleting, for the reason the other
 * backfills are kept: a daily run that was skipped, or a stretch where the model
 * key was missing, leaves exactly the same gap and this is the repair.
 *
 * Idempotent, and capped at three notes a call by the explainer's own limit.
 * A movement that already has a note is skipped rather than explained again,
 * so calling this repeatedly walks further back each time and costs nothing
 * once it has caught up. Compare `found` against `written` to see whether
 * another call has anything left to do.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://ustozaidashboard.vercel.app/api/cron/backfill-notes?days=30"
 *
 * Deliberately not on a schedule. It costs a model call per movement, and the
 * daily run is what keeps the feed current once this has caught it up.
 */

const MAX_WINDOW = 120;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  // Said plainly rather than returning an empty result. Without a key this
  // finds every movement and explains none of them, which looks identical to
  // a quiet month unless somebody says otherwise.
  if (!openaiKey()) {
    return Response.json(
      { ok: false, error: "OPENAI_API_KEY is not set on this deployment" },
      { status: 503 },
    );
  }

  const requested = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_WINDOW)
    : 30;

  const started = Date.now();
  try {
    const summary = await backfillNotes(days);

    return Response.json({
      ok: true,
      window: days,
      // Both counts, because they differ for two very different reasons: a
      // movement can already have a note, or the run can have hit its cap.
      found: summary.found.length,
      written: summary.written.length,
      movements: summary.found.map((movement) => ({
        metric: movement.metricKey,
        date: movement.date,
        direction: movement.direction,
        detail: movement.detail,
      })),
      notes: summary.written,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
