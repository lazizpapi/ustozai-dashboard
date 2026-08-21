import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { PULSE_DEADLINE_MS, runPulse } from "@/lib/collectors/run-pulse";

export const dynamic = "force-dynamic";

/**
 * Next requires this to be a literal, so it cannot be derived from
 * PULSE_DEADLINE_MS. pulse.test.ts imports this value and asserts the deadline
 * still sits below it, so the two cannot drift apart unnoticed.
 */
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
 *
 * Holding to that convention is why the run carries its own deadline. Being
 * killed by the platform returns no body at all, which is indistinguishable
 * from the route never having been reached, and the body is the only record
 * pg_net keeps in net._http_response.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  try {
    const summary = await runPulse({
      includeReviews: true,
      deadlineMs: PULSE_DEADLINE_MS,
    });
    return Response.json({ ok: summary.failures.length === 0, ...summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
