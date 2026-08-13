import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { runPoll } from "@/lib/collectors/run-poll";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Frequent poll: chart position, rating, Play installs.
 *
 * Always answers 200 when the run completed, even with failed sources, because
 * a partial run is a success: the healthy feeds were recorded. Per-source
 * failures are in the response body and in collector_runs. Reserving non-2xx
 * for "the run itself could not happen" keeps scheduler alerting meaningful.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  try {
    const summary = await runPoll();
    return Response.json({ ok: summary.failures.length === 0, ...summary });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
