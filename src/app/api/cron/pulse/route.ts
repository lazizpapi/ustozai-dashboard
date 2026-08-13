import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { runPulse } from "@/lib/collectors/run-pulse";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The fast lane, on a five minute schedule.
 *
 * Page loads already fetch a new audience reading when the stored one is
 * stale, so on a day when the wall display is on this route mostly finds that
 * work already done. It is the floor for the days it is off, so the
 * week-over-week comparison is built from an even sample rather than from
 * whenever somebody opened a browser.
 *
 * Reviews are requested here and nowhere else. This is the only caller on a
 * schedule, so it is the only one that should pay for an extra feed that a
 * page render has no reason to wait on.
 *
 * Same convention as the other cron routes: 200 whenever the run completed,
 * with per-source failures in the body, so a non-2xx keeps meaning "the run
 * could not happen at all".
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  try {
    const summary = await runPulse({ includeReviews: true });
    return Response.json({ ok: summary.failures.length === 0, ...summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
