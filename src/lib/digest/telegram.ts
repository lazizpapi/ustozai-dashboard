import "server-only";

import { telegramEnv } from "@/lib/env";

/**
 * Returned rather than thrown when Telegram is unconfigured, so a project
 * without a bot token still runs its collectors cleanly instead of logging a
 * failure every morning.
 */
export interface TelegramResult {
  sent: boolean;
  reason?: string;
}

/**
 * One message to the configured chat.
 *
 * Extracted from sendDailyDigest so the collector alerts can reach the same
 * chat without rebuilding the request. HTML parse mode, because every caller
 * formats with <b> and escapes its own interpolations.
 */
export async function sendTelegramMessage(text: string): Promise<TelegramResult> {
  const config = telegramEnv();
  if (!config) return { sent: false, reason: "Telegram is not configured" };

  const response = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: `Telegram ${response.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}
