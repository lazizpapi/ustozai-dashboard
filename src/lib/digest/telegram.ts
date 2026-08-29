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
 *
 * replyTo threads the message to the one that prompted it, which matters only
 * for answers: in a group where people are talking, an answer arriving as a
 * loose message has no visible connection to the question. Optional, so the
 * alerts and the digest -- which reply to nothing -- are unchanged.
 */
export async function sendTelegramMessage(
  text: string,
  options: { replyTo?: number } = {},
): Promise<TelegramResult> {
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
        ...(options.replyTo === undefined
          ? {}
          : {
              // allow_sending_without_reply, because a question deleted while
              // the analyst was thinking must not swallow the answer too.
              reply_parameters: {
                message_id: options.replyTo,
                allow_sending_without_reply: true,
              },
            }),
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: `Telegram ${response.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}

/**
 * The three dots, so a slow answer does not look like no answer.
 *
 * The analyst can take a minute of tool calls, and until now the group saw
 * nothing at all between asking and being answered, which reads as a bot that
 * ignored you. Telegram shows the indicator for about five seconds; it is a
 * receipt rather than a progress bar, and that is the useful part.
 *
 * Never throws and never reports. Failing to show a typing indicator is not
 * something any caller should change its behaviour over.
 */
export async function sendTelegramTyping(): Promise<void> {
  const config = telegramEnv();
  if (!config) return;

  try {
    await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendChatAction`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, action: "typing" }),
      },
    );
  } catch {
    // Deliberately silent.
  }
}
