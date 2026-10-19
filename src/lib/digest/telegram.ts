import "server-only";

import { telegramEnv } from "@/lib/env";
import type { InlineKeyboard } from "@/lib/jarvis/reminder-posts";

/**
 * Returned rather than thrown when Telegram is unconfigured, so a project
 * without a bot token still runs its collectors cleanly instead of logging a
 * failure every morning.
 */
/** How long one Bot API call may take. */
const TELEGRAM_TIMEOUT_MS = 10_000;

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
  options: { replyTo?: number; keyboard?: InlineKeyboard } = {},
): Promise<TelegramResult> {
  const config = telegramEnv();
  if (!config) return { sent: false, reason: "Telegram is not configured" };

  // Not sent, rather than thrown, when Telegram cannot be reached at all; and
  // bounded, so a stalled connection cannot eat a cron run's time.
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: config.TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          // Buttons under the message: reminders' "Bajarildi" (reminder-posts.ts).
          ...(options.keyboard
            ? { reply_markup: { inline_keyboard: options.keyboard } }
            : {}),
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
  } catch (error) {
    return {
      sent: false,
      reason: `Telegram unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

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

/** One Bot API call; not sent when Telegram is not configured, cannot be reached, or did not say ok. */
async function botApi(
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramResult & { result?: unknown }> {
  const config = telegramEnv();
  if (!config) return { sent: false, reason: "Telegram is not configured" };
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    return {
      sent: false,
      reason: `Telegram unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: unknown;
    description?: string;
  } | null;
  if (!response.ok || !payload?.ok) {
    return {
      sent: false,
      reason: `Telegram ${response.status}: ${String(payload?.description ?? "").slice(0, 200)}`,
    };
  }
  return { sent: true, result: payload.result };
}

/** Redraws a posted message in place: a reminder ticked off from its button. */
export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  keyboard: InlineKeyboard,
): Promise<TelegramResult> {
  return botApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  });
}

/** Stops a tapped button's spinner, with a short note for whoever tapped it. */
export async function answerTelegramTap(
  callbackId: string,
  text: string,
): Promise<TelegramResult> {
  return botApi("answerCallbackQuery", { callback_query_id: callbackId, text });
}

/** Where the webhook points and which updates it delivers, as Telegram has it. */
export async function telegramWebhookInfo(): Promise<{
  url: string;
  allowedUpdates?: string[];
} | null> {
  const answer = await botApi("getWebhookInfo", {});
  const info = answer.result as
    { url?: unknown; allowed_updates?: unknown } | undefined;
  if (!answer.sent || typeof info?.url !== "string") return null;
  return {
    url: info.url,
    allowedUpdates: Array.isArray(info.allowed_updates)
      ? info.allowed_updates.filter((u): u is string => typeof u === "string")
      : undefined,
  };
}

/**
 * Re-registers the webhook at the same address with a new update list. The
 * secret goes with it, because a registration without one drops it, and the
 * webhook route then refuses every update.
 */
export async function registerTelegramWebhook(
  url: string,
  secret: string,
  allowedUpdates: string[],
): Promise<TelegramResult> {
  return botApi("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: allowedUpdates,
  });
}
