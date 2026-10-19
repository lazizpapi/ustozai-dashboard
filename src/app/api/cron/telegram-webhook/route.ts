import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { allowedUpdatesWithTaps } from "@/lib/collectors/telegram-webhook";
import { registerTelegramWebhook, telegramWebhookInfo } from "@/lib/digest/telegram";
import { telegramWebhookSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/telegram-webhook: lets reminder buttons reach the webhook.
 *
 * Telegram delivers only the update types the webhook was registered with,
 * and button taps were never among them. Run once, by hand, with the cron
 * secret: it reads the current registration, adds button taps to its update
 * list, and registers it again at the same address with this deployment's own
 * secret, so the bot token and secret never leave Vercel. Safe to repeat: it
 * changes nothing when taps are already delivered.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const secret = telegramWebhookSecret();
  if (!secret) {
    return Response.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not set" }, { status: 503 });
  }

  const info = await telegramWebhookInfo();
  if (!info?.url) {
    return Response.json(
      { ok: false, error: "could not read the webhook from Telegram, or it is not registered" },
      { status: 409 },
    );
  }

  const allowedUpdates = allowedUpdatesWithTaps(info.allowedUpdates);
  if (!allowedUpdates) {
    return Response.json({ ok: true, changed: false, allowedUpdates: info.allowedUpdates ?? "Telegram's default" });
  }

  const result = await registerTelegramWebhook(info.url, secret, allowedUpdates);
  return Response.json(
    { ok: result.sent, changed: result.sent, allowedUpdates, ...(result.reason ? { error: result.reason } : {}) },
    { status: result.sent ? 200 : 502 },
  );
}
