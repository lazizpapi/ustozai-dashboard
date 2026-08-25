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
  | { kind: "question"; text: string }
  | { kind: "help" }
  | { kind: "ignore"; reason: string };

interface ChatMemberUpdate {
  chat_member?: {
    chat?: { username?: unknown; type?: unknown };
  };
  message?: {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { is_bot?: unknown };
  };
}

/**
 * Longest question worth forwarding to the analyst.
 *
 * Matches the chat endpoint. A Telegram message can be four thousand
 * characters and none of the last three thousand would be a question.
 */
export const MAX_QUESTION_CHARS = 2_000;

/**
 * Which messages are addressed to the bot.
 *
 * A group is the normal home for the digest chat, and people talk in it.
 * Answering every line would be expensive, slow and rude, so in a group the
 * bot speaks only when spoken to: /ask, or /ask@thisbot, which is the form
 * Telegram rewrites commands into when several bots share a room.
 *
 * A private chat needs no prefix. Every message there is addressed to the bot
 * by definition, and making somebody type /ask into a one-to-one conversation
 * is the kind of friction that stops a tool being used.
 */
function asCommand(text: string): { command: string; rest: string } | null {
  const match = text.match(/^\/([a-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), rest: (match[2] ?? "").trim() };
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
export function classifyUpdate(
  update: unknown,
  channel: string,
  askChatId?: string | null,
): UpdateVerdict {
  if (typeof update !== "object" || update === null) {
    return { kind: "ignore", reason: "body is not an object" };
  }

  const message = (update as ChatMemberUpdate).message;
  if (message) return classifyMessage(message, askChatId);

  const membership = (update as ChatMemberUpdate).chat_member;
  if (!membership) {
    // my_chat_member (the bot's own status), edits, everything else.
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

/**
 * Whether a message is a question we are willing to answer, and from whom.
 *
 * The secret header proves the request came from Telegram. It says nothing
 * about who sent the message, and anybody can find a bot and write to it, so
 * the allowlist is what actually protects the answer: the analyst can read the
 * revenue, and a stranger asking what the company took last month must get
 * silence rather than a figure.
 *
 * Silence, specifically, and never a refusal. Replying "you are not allowed"
 * confirms there is something here worth being allowed into, and invites a
 * second try. An unknown chat is ignored exactly like a chat_member update for
 * some other channel.
 */
function classifyMessage(
  message: NonNullable<ChatMemberUpdate["message"]>,
  askChatId?: string | null,
): UpdateVerdict {
  // No allowlist means no answering. Closed by default, like the secret.
  if (!askChatId) return { kind: "ignore", reason: "no ask chat configured" };

  // Bots include this bot. Answering one is how two bots talk to each other
  // until somebody notices the bill.
  if (message.from?.is_bot === true) return { kind: "ignore", reason: "message from a bot" };

  const chatId = message.chat?.id;
  if (chatId === undefined || String(chatId) !== String(askChatId)) {
    return { kind: "ignore", reason: "message from another chat" };
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  if (text.length === 0) return { kind: "ignore", reason: "message has no text" };

  const command = asCommand(text);
  if (command) {
    if (command.command === "start" || command.command === "help") return { kind: "help" };
    if (command.command !== "ask") {
      return { kind: "ignore", reason: `unknown command: ${command.command}` };
    }
    if (command.rest.length === 0) return { kind: "help" };
    return { kind: "question", text: command.rest.slice(0, MAX_QUESTION_CHARS) };
  }

  // Bare text, which counts only where it cannot be ambient chatter.
  if (message.chat?.type !== "private") {
    return { kind: "ignore", reason: "not addressed to the bot" };
  }

  return { kind: "question", text: text.slice(0, MAX_QUESTION_CHARS) };
}
