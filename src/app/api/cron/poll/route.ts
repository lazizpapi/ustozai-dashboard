import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { runPoll } from "@/lib/collectors/run-poll";
import { claimReminderPost, recordRuns, unclaimReminderPost } from "@/lib/db/persist";
import { remindersDueBy } from "@/lib/db/queries";
import { sendTelegramMessage } from "@/lib/digest/telegram";
import { postDueReminders, type PostResult } from "@/lib/jarvis/reminder-posts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Frequent poll: chart position, rating, Play installs.
 *
 * Always answers 200 when the run completed, even with failed sources, because
 * a partial run is a success: the healthy feeds were recorded. Per-source
 * failures are in the response body and in collector_runs. Reserving non-2xx
 * for "the run itself could not happen" keeps scheduler alerting meaningful.
 *
 * The 9:00 run (Tashkent) also posts the departments' due reminders to the
 * team's Telegram group (src/lib/jarvis/reminder-posts.ts). First, so they go
 * out on time whatever the collectors do, and on its own, so neither can fail
 * the other.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const reminders = await postReminders();

  try {
    const summary = await runPoll();
    return Response.json({ ok: summary.failures.length === 0, ...summary, reminders });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error), reminders },
      { status: 500 },
    );
  }
}

/** The reminders step, recorded with the collectors so a failure shows on IT's health check. */
async function postReminders(): Promise<PostResult> {
  let result: PostResult;
  try {
    result = await postDueReminders({
      now: new Date(),
      due: remindersDueBy,
      claim: claimReminderPost,
      unclaim: unclaimReminderPost,
      send: (text, keyboard) => sendTelegramMessage(text, { keyboard }),
    });
  } catch (error) {
    result = { posted: 0, failed: [error instanceof Error ? error.message : String(error)] };
  }
  if (result.skipped) return result;

  const failed = result.failed ?? [];
  await recordRuns([
    {
      source: "jarvis-reminders",
      status: failed.length > 0 ? "failed" : "ok",
      records: result.posted,
      ...(failed.length > 0 ? { error: failed.join("; ").slice(0, 500) } : {}),
    },
  ]).catch((error) => console.error("could not record the reminders run:", error));
  return result;
}
