import "server-only";

import { TELEGRAM_LIMIT, formatAnalystMessage } from "@/lib/analyst/format";
import { escapeHtml } from "@/lib/collectors/alerts";
import type { AnalystRow } from "@/lib/db/queries";
import type { TelegramResult } from "@/lib/digest/telegram";

import type { JarvisResponse } from "./handle";

/**
 * What Jarvis may post to the team's Telegram chat, and how.
 *
 * Reached only when JARVIS_ACTIONS_ENABLED is on and the request is a POST;
 * handle.ts decides that. By then Jarvis has read the message back and heard
 * a yes, a check that lives on the Jarvis side next to the microphone. This
 * file makes sure what reaches the chat is what was meant:
 *
 * send_report posts the latest analyst report exactly as the analyst formats
 * it for Telegram, and answers with when that report was written, so Jarvis
 * can say how old it is.
 *
 * send_telegram posts a short message, escaped, since the chat parses HTML,
 * and labelled, so nobody mistakes it for a person. The limit is checked on
 * the escaped text: a thousand ampersands fit the character limit and would
 * still be rejected whole by Telegram at five characters each.
 *
 * A message Telegram did not take answers 502, never 200, because Jarvis
 * reads success aloud as "sent".
 */

export const JARVIS_LABEL = "<b>Sent by Jarvis</b>";
export const MAX_MESSAGE_CHARS = 1000;

export type ActionTool = "send_telegram" | "send_report";

export type ActionDeps = {
  latestReport: () => Promise<AnalystRow | null>;
  send: (text: string) => Promise<TelegramResult>;
  reportUrl?: string;
};

function refused(error: string): JarvisResponse {
  return { status: 422, body: { ok: false, error } };
}

function notDelivered(result: TelegramResult): JarvisResponse {
  return { status: 502, body: { ok: false, error: result.reason ?? "Telegram did not take it" } };
}

async function sendReport(deps: ActionDeps): Promise<JarvisResponse> {
  const row = await deps.latestReport();
  if (!row?.report) return refused("There is no analyst report to send yet.");

  const result = await deps.send(formatAnalystMessage(row.report, deps.reportUrl));
  if (!result.sent) return notDelivered(result);
  return {
    status: 200,
    body: { ok: true, tool: "send_report", sent: true, reportCreatedAt: row.createdAt, headline: row.headline },
  };
}

async function sendMessage(args: Record<string, unknown>, deps: ActionDeps): Promise<JarvisResponse> {
  if (typeof args.text !== "string") return refused("A message needs text.");
  const text = args.text.trim();
  if (text.length === 0) return refused("A message needs text.");
  if (text.length > MAX_MESSAGE_CHARS) {
    return refused(`A message can be at most ${MAX_MESSAGE_CHARS} characters.`);
  }

  const message = `${JARVIS_LABEL}\n${escapeHtml(text)}`;
  if (message.length > TELEGRAM_LIMIT) return refused("That message is too long for Telegram.");

  const result = await deps.send(message);
  if (!result.sent) return notDelivered(result);
  return { status: 200, body: { ok: true, tool: "send_telegram", sent: true, text } };
}

export async function runJarvisAction(
  tool: ActionTool,
  args: Record<string, unknown>,
  deps: ActionDeps,
): Promise<JarvisResponse> {
  return tool === "send_report" ? sendReport(deps) : sendMessage(args, deps);
}
