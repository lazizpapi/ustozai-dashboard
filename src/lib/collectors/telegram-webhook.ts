/**
 * Deciding what a Telegram webhook call means.
 *
 * Split from the route so the judgement is testable against saved payloads,
 * the same split every collector in this directory uses. The route does the
 * IO; everything here is a pure function of the update body.
 *
 * The design decision worth recording: an update never supplies the member
 * count, only that somebody's status changed. There is no arithmetic to trust
 * even if we wanted to trust it, so a relevant update triggers an
 * authoritative getChatMemberCount rather than an increment. That also makes
 * the whole path idempotent, which is what lets bursts be dropped safely.
 */

/**
 * How close together two authoritative reads may be.
 *
 * A hundred people joining after a post produces a hundred updates in a few
 * seconds, and each one is a request to Telegram if left ungoverned. Because
 * the read is authoritative rather than incremental, discarding all but one of
 * them loses nothing: the survivor already reflects every join in the burst.
 *
 * Ten seconds because that is fast enough to look instant on a wall display
 * and slow enough that a burst cannot turn into a request storm.
 */
export const WEBHOOK_REFRESH_FLOOR_MS = 10_000;

export type UpdateVerdict =
  | { kind: "refresh" }
  | { kind: "ignore"; reason: string };

interface ChatMemberUpdate {
  chat_member?: {
    chat?: { username?: unknown; type?: unknown };
  };
}

/**
 * Whether this update is one we asked for, about the channel we track.
 *
 * setWebhook already filters server-side via allowed_updates, so in normal
 * operation everything arriving here is a chat_member update. The check stays
 * anyway: allowed_updates is re-sent on every setWebhook call, and a later
 * registration that forgets it, or names the wrong list, would start
 * delivering messages and edits to this route. That should be a no-op, not a
 * burst of pointless Bot API calls.
 *
 * The channel is compared too, because the bot may be an administrator of
 * other chats and their joins say nothing about @ustozai.
 */
export function classifyUpdate(update: unknown, channel: string): UpdateVerdict {
  if (typeof update !== "object" || update === null) {
    return { kind: "ignore", reason: "body is not an object" };
  }

  const membership = (update as ChatMemberUpdate).chat_member;
  if (!membership) {
    // my_chat_member (the bot's own status), messages, edits, everything else.
    return { kind: "ignore", reason: "not a chat_member update" };
  }

  const username = membership.chat?.username;
  if (typeof username !== "string" || username.length === 0) {
    // Private groups have no username. We track a public channel by handle, so
    // an update without one cannot be matched to it.
    return { kind: "ignore", reason: "chat has no username" };
  }

  if (username.toLowerCase() !== channel.toLowerCase().replace(/^@/, "")) {
    return { kind: "ignore", reason: `different chat: ${username}` };
  }

  return { kind: "refresh" };
}
