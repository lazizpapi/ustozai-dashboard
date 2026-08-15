import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { runAnalyst } from "@/lib/analyst/run-analyst";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily analyst.
 *
 * Scheduled after the daily collector so it reads a closed day rather than a
 * half-collected one. `?silent=1` runs it without sending to Telegram, which
 * is how a run gets triggered by hand without messaging the team.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const silent = new URL(request.url).searchParams.get("silent") === "1";

  try {
    const result = await runAnalyst({ silent });
    // A refusal to analyse stale data is a correct outcome, not an error, so
    // it reports ok:true. Only a genuine failure is a failure.
    return Response.json({ ok: result.status !== "failed", ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
