import { isAuthorizedCron, unauthorized } from "@/lib/cron-auth";
import { webhookRegistration } from "@/lib/collectors/telegram-webhook";
import { registerTelegramWebhook, telegramWebhookInfo } from "@/lib/digest/telegram";
import { telegramWebhookSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/telegram-webhook: lets reminder buttons reach the webhook.
 *
 * Telegram delivers only the update types the webhook was registered with.
 * Run once, by hand, with the cron secret. With no registration yet (the case
 * on 19 October 2026), it registers this dashboard's webhook route for button
 * taps alone; with one, it adds taps to its update list at the same address.
 * Either way with this deployment's own secret, so the bot token and secret
 * never leave Vercel. Safe to repeat: it changes nothing once taps arrive.
 */
export async function POST(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized();

  const secret = telegramWebhookSecret();
  if (!secret) {
    return Response.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not set" }, { status: 503 });
  }

  const info = await telegramWebhookInfo();
  if (!info) {
    return Response.json({ ok: false, error: "could not read the webhook from Telegram" }, { status: 502 });
  }

  const ownUrl = new URL("/api/webhook/telegram", request.url).toString();
  const next = webhookRegistration(info, ownUrl);
  if (!next) {
    return Response.json({ ok: true, changed: false, allowedUpdates: info.allowedUpdates ?? "Telegram's default" });
  }

  const result = await registerTelegramWebhook(next.url, secret, next.allowedUpdates);
  return Response.json(
    {
      ok: result.sent,
      changed: result.sent,
      url: next.url,
      allowedUpdates: next.allowedUpdates,
      ...(result.reason ? { error: result.reason } : {}),
    },
    { status: result.sent ? 200 : 502 },
  );
}
