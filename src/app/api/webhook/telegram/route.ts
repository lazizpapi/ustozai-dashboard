import { safeEqual } from "@/lib/cron-auth";
import { socialEnv, telegramWebhookSecret } from "@/lib/env";
import { fetchTelegramMembers } from "@/lib/collectors/social";
import { isDue } from "@/lib/collectors/freshen";
import {
  WEBHOOK_REFRESH_FLOOR_MS,
  classifyUpdate,
} from "@/lib/collectors/telegram-webhook";
import { hourBucket, saveSocialSnapshots } from "@/lib/db/persist";
import { latestPlatformCheck } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

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

  const verdict = classifyUpdate(update, social.telegram.channel);
  if (verdict.kind === "ignore") return ok({ ignored: verdict.reason });

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
