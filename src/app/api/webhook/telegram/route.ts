import { after } from "next/server";

import { safeEqual } from "@/lib/cron-auth";
import { ask } from "@/lib/analyst/ask";
import { escapeHtml } from "@/lib/collectors/alerts";
import { sendTelegramMessage } from "@/lib/digest/telegram";
import { openaiKey, socialEnv, telegramEnv, telegramWebhookSecret } from "@/lib/env";
import { fetchTelegramMembers } from "@/lib/collectors/social";
import { isDue } from "@/lib/collectors/freshen";
import {
  WEBHOOK_REFRESH_FLOOR_MS,
  classifyUpdate,
} from "@/lib/collectors/telegram-webhook";
import { hourBucket, saveSocialSnapshots } from "@/lib/db/persist";
import { latestPlatformCheck } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
/*
 * Ten seconds covered a member count. An answer runs the analyst, which may
 * take several tool steps, and after() runs inside the route's budget rather
 * than outside it, so the ceiling has to cover the slower path. It is a
 * ceiling and not a reservation: the membership path still returns in about
 * half a second and costs nothing extra for the headroom.
 */
export const maxDuration = 300;

/**
 * Telegram calls this the moment somebody joins or leaves the channel.
 *
 * The only genuinely live number on the dashboard. Everything else is bounded
 * by its publisher: Apple recomputes charts a few times a day and publishes
 * downloads in arrears, Google's install counter moves once a day, YouTube
 * rounds to three significant figures. Telegram is the one source that will
 * tell us the instant something changes, so it gets a push path.
 *
 * The five-minute pulse still reads Telegram. This route is an accelerator,
 * not a replacement: delivery depends on the bot remaining a channel
 * administrator, and Telegram discards queued updates after 24 hours, so
 * without a poll behind it a silently unregistered webhook would look exactly
 * like a channel nobody is joining.
 */

/**
 * Shared across calls that land on the same warm instance.
 *
 * The real burst guard is the timestamp check below, which works across
 * instances; this only stops two updates arriving in the same instant from
 * both reaching Telegram. Same pattern and the same reason as freshen.ts.
 */
let inFlight: Promise<void> | null = null;

function ok(body: Record<string, unknown>): Response {
  // Always 200 once the secret checks out. Telegram retries anything else, and
  // a retry is never the right answer here: the next update or the pulse will
  // reconcile, so a failure loop would cost requests and fix nothing.
  return Response.json({ ok: true, ...body });
}

export async function POST(request: Request) {
  const secret = telegramWebhookSecret();
  const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";

  // An unset secret denies everything. A deploy that has not been given the
  // secret should be closed, not open, exactly like DASHBOARD_PASSWORD.
  if (!secret || !safeEqual(header, secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const social = socialEnv();
  if (!social.telegram) return ok({ ignored: "telegram is not configured" });

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    // Malformed body from an authenticated caller. Nothing to do, but nothing
    // to retry either.
    return ok({ ignored: "unparseable body" });
  }

  const verdict = classifyUpdate(update, social.telegram.channel, telegramEnv()?.TELEGRAM_CHAT_ID);
  if (verdict.kind === "ignore") return ok({ ignored: verdict.reason });

  if (verdict.kind === "help") {
    after(() => sendTelegramMessage(HELP).then(() => undefined));
    return ok({ replied: "help" });
  }

  if (verdict.kind === "question") {
    if (!openaiKey()) {
      after(() =>
        sendTelegramMessage("The analyst is not configured on this deployment.").then(
          () => undefined,
        ),
      );
      return ok({ replied: "unconfigured" });
    }

    /*
     * Answered after the response rather than before it.
     *
     * The membership path can afford to be awaited because it is one Bot API
     * call and one upsert. An answer is a model call with up to eight tool
     * steps behind it, which is far past what Telegram will wait for, and a
     * webhook that does not answer promptly is retried: the same question
     * would be asked again, and again, each retry costing another answer.
     */
    after(() => answer(verdict.text));
    return ok({ asked: true });
  }

  const lastChecked = await latestPlatformCheck("telegram").catch(() => null);
  if (!isDue(lastChecked, Date.now(), WEBHOOK_REFRESH_FLOOR_MS)) {
    return ok({ skipped: "read within the last few seconds" });
  }

  /*
   * Awaited rather than answered early and finished in the background.
   *
   * Returning first would be faster to Telegram and would risk losing the
   * write: without an explicit keep-alive the platform is free to freeze the
   * function once the response is sent. One Bot API call and one upsert is
   * roughly half a second, which is well inside what Telegram considers
   * prompt, so there is nothing to buy by racing it.
   */
  inFlight ??= (async () => {
    const snapshot = await fetchTelegramMembers(
      social.telegram!.channel,
      social.telegram!.botToken,
    );
    await saveSocialSnapshots([snapshot], hourBucket());
  })()
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });

  await inFlight;
  return ok({ refreshed: "telegram" });
}

const HELP =
  "Ask about the numbers and I will read them before answering.\n\n" +
  "In here: <b>/ask how were downloads last week?</b>\n" +
  "In a direct message: just write the question.\n\n" +
  "I can reach downloads, chart position, competitors, keywords, reviews, " +
  "audience, takings, active users and the daily report.";

/** Telegram rejects anything longer, and a long answer is a worse answer. */
const MAX_REPLY_CHARS = 3_500;

/**
 * The analyst's answer, made safe for Telegram.
 *
 * Escaped first, because the reply goes out in HTML parse mode and a model is
 * perfectly capable of writing a < in a sentence about a rank. An unescaped
 * angle bracket is not a formatting problem, it is a rejected message and a
 * question that appears to have been ignored.
 *
 * The bold pass runs after escaping, on the asterisks the escape left alone,
 * so the common markdown the model reaches for survives as markup rather than
 * as literal punctuation.
 */
function toTelegramHtml(answer: string): string {
  const trimmed =
    answer.length > MAX_REPLY_CHARS
      ? `${answer.slice(0, MAX_REPLY_CHARS)}\n\nThat answer was cut short.`
      : answer;

  return escapeHtml(trimmed).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/**
 * Ask, then reply. Never throws.
 *
 * Runs after the response has gone, so nothing it does can affect what
 * Telegram was told, and an exception here would otherwise surface as an
 * unhandled rejection in a function that has already finished its request.
 * A failure still speaks: a question that gets no reply at all is
 * indistinguishable from a bot that is broken.
 */
async function answer(question: string): Promise<void> {
  try {
    const result = await ask(question, [], "/telegram");
    await sendTelegramMessage(toTelegramHtml(result.answer));
  } catch (error) {
    console.error("could not answer a Telegram question:", error);
    await sendTelegramMessage("I could not answer that one. Try asking it more narrowly.").catch(
      () => undefined,
    );
  }
}
