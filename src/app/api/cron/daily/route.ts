import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { runDaily } from "@/lib/collectors/run-daily";
import { sendDailyDigest } from "@/lib/digest/send";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily run: keyword positions, review sync, iOS downloads, then the digest.
 *
 * The digest is sent last and its failure is reported without failing the run.
 * Losing a Telegram message is an inconvenience; losing the day's collected
 * data because the message failed would not be.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  try {
    const summary = await runDaily();

    let digest: { sent: boolean; reason?: string };
    try {
      digest = await sendDailyDigest();
    } catch (error) {
      digest = {
        sent: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    return Response.json({ ok: summary.failures.length === 0, ...summary, digest });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
