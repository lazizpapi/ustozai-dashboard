import { describe, expect, it } from "vitest";

import { WEBHOOK_REFRESH_FLOOR_MS, classifyUpdate,
  MAX_QUESTION_CHARS,
} from "./telegram-webhook";
import { isDue } from "./freshen";
import update from "./__fixtures__/telegram-chat-member-update.json";

/**
 * The webhook's judgement, tested where it is decidable: which updates deserve
 * a Bot API call, and how close together those calls may be.
 *
 * Both questions are load-bearing in the same direction. Being too permissive
 * turns a hundred people joining after a post into a hundred requests; being
 * too strict turns the live path back into the five-minute poll without
 * anything reporting that it happened.
 */

describe("classifyUpdate", () => {
  it("refreshes on a join in the tracked channel", () => {
    expect(classifyUpdate(update, "ustozai")).toEqual({ kind: "refresh" });
  });

  it("accepts the channel configured with a leading @", () => {
    // socialEnv strips it, but the webhook must not depend on that having
    // happened somewhere else.
    expect(classifyUpdate(update, "@ustozai")).toEqual({ kind: "refresh" });
  });

  it("matches the channel case-insensitively", () => {
    expect(classifyUpdate(update, "UstozAI")).toEqual({ kind: "refresh" });
  });

  it("ignores a chat_member update for a different chat", () => {
    // The bot may administer other chats; their joins say nothing about ours.
    const other = { chat_member: { chat: { username: "someothergroup" } } };
    expect(classifyUpdate(other, "ustozai")).toMatchObject({ kind: "ignore" });
  });

  it("ignores update types we did not subscribe to", () => {
    // allowed_updates filters these server-side, but a later setWebhook that
    // omits or mistypes the list would start delivering them, and that should
    // cost nothing rather than hammering the Bot API.
    //
    // Messages are no longer an example of this: they are subscribed to on
    // purpose now, and what makes an unwanted one cost nothing is the chat
    // allowlist rather than the update type. Edits still are.
    expect(classifyUpdate({ edited_message: { text: "hi" } }, "ustozai")).toMatchObject({
      kind: "ignore",
      reason: "not a chat_member update",
    });
  });

  it("ignores a message when no chat has been allowlisted", () => {
    // The same guarantee the test above used to make: an update we cannot
    // act on costs nothing. Closed by default.
    expect(classifyUpdate({ message: { text: "hi" } }, "ustozai")).toMatchObject({
      kind: "ignore",
    });
  });

  it("ignores my_chat_member, which is the bot's own status changing", () => {
    const own = { my_chat_member: { chat: { username: "ustozai" } } };
    expect(classifyUpdate(own, "ustozai")).toMatchObject({ kind: "ignore" });
  });

  it("ignores a chat with no username, which cannot be matched by handle", () => {
    const private_ = { chat_member: { chat: { id: -100, type: "group" } } };
    expect(classifyUpdate(private_, "ustozai")).toMatchObject({
      kind: "ignore",
      reason: "chat has no username",
    });
  });

  it("ignores a body that is not an object at all", () => {
    expect(classifyUpdate(null, "ustozai")).toMatchObject({ kind: "ignore" });
    expect(classifyUpdate("nonsense", "ustozai")).toMatchObject({ kind: "ignore" });
  });
});

describe("the burst floor", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  it("allows a read when nothing has been recorded", () => {
    expect(isDue(null, now, WEBHOOK_REFRESH_FLOOR_MS)).toBe(true);
  });

  it("collapses a burst into one read", () => {
    // A second join a moment later must not produce a second Bot API call: the
    // first read already counted it, because the count is authoritative rather
    // than incremented.
    const justRead = new Date(now - 500).toISOString();
    expect(isDue(justRead, now, WEBHOOK_REFRESH_FLOOR_MS)).toBe(false);
  });

  it("allows the next read once the floor has passed", () => {
    const old = new Date(now - WEBHOOK_REFRESH_FLOOR_MS - 1).toISOString();
    expect(isDue(old, now, WEBHOOK_REFRESH_FLOOR_MS)).toBe(true);
  });

  it("is far tighter than the page render window, so pushes are not swallowed", () => {
    // Guards against someone later reusing the 55 second render threshold
    // here, which would make the live path no faster than the polled one.
    expect(WEBHOOK_REFRESH_FLOOR_MS).toBeLessThan(30_000);
  });
});

describe("messages to the bot", () => {
  /*
   * The secret header proves an update came from Telegram. It says nothing
   * about who wrote the message, and anybody can find a bot and message it,
   * so the allowlist is the only thing standing between a stranger and the
   * company's revenue.
   */
  const CHAT = "-1001234567890";

  const message = (over: Record<string, unknown> = {}) => ({
    message: {
      text: "/ask how were downloads?",
      chat: { id: CHAT, type: "group" },
      from: { is_bot: false },
      ...over,
    },
  });

  it("answers a /ask from the allowlisted chat", () => {
    expect(classifyUpdate(message(), "ustozai", CHAT)).toEqual({
      kind: "question",
      text: "how were downloads?",
    });
  });

  it("ignores every other chat in silence", () => {
    // Silence, not a refusal: a refusal confirms there is something here.
    const verdict = classifyUpdate(
      message({ chat: { id: "-100999", type: "group" } }),
      "ustozai",
      CHAT,
    );

    expect(verdict.kind).toBe("ignore");
  });

  it("answers nobody when no chat is allowlisted", () => {
    expect(classifyUpdate(message(), "ustozai", undefined).kind).toBe("ignore");
    expect(classifyUpdate(message(), "ustozai", null).kind).toBe("ignore");
  });

  it("never answers another bot", () => {
    const verdict = classifyUpdate(message({ from: { is_bot: true } }), "ustozai", CHAT);

    expect(verdict.kind).toBe("ignore");
  });

  it("stays out of ambient group chatter", () => {
    // A group is where the digest lives and where people talk.
    const verdict = classifyUpdate(
      message({ text: "morning everyone", chat: { id: CHAT, type: "group" } }),
      "ustozai",
      CHAT,
    );

    expect(verdict.kind).toBe("ignore");
  });

  it("needs no prefix in a direct message", () => {
    const verdict = classifyUpdate(
      message({ text: "how were downloads?", chat: { id: CHAT, type: "private" } }),
      "ustozai",
      CHAT,
    );

    expect(verdict).toEqual({ kind: "question", text: "how were downloads?" });
  });

  it("understands the @botname form Telegram rewrites commands into", () => {
    const verdict = classifyUpdate(
      message({ text: "/ask@ustozai_bot what is our rank?" }),
      "ustozai",
      CHAT,
    );

    expect(verdict).toEqual({ kind: "question", text: "what is our rank?" });
  });

  it("offers help for /start, /help and a bare /ask", () => {
    for (const text of ["/start", "/help", "/ask"]) {
      expect(classifyUpdate(message({ text }), "ustozai", CHAT).kind).toBe("help");
    }
  });

  it("ignores a command it does not know", () => {
    expect(classifyUpdate(message({ text: "/deploy" }), "ustozai", CHAT).kind).toBe("ignore");
  });

  it("ignores a message with no text at all", () => {
    const verdict = classifyUpdate(message({ text: undefined }), "ustozai", CHAT);

    expect(verdict.kind).toBe("ignore");
  });

  it("caps a very long question rather than forwarding all of it", () => {
    const verdict = classifyUpdate(
      message({ text: `/ask ${"a".repeat(5_000)}` }),
      "ustozai",
      CHAT,
    );

    expect(verdict.kind).toBe("question");
    if (verdict.kind === "question") {
      expect(verdict.text.length).toBe(MAX_QUESTION_CHARS);
    }
  });

  it("compares chat ids across types, since Telegram sends them as numbers", () => {
    const numeric = classifyUpdate(
      message({ chat: { id: -1001234567890, type: "group" } }),
      "ustozai",
      "-1001234567890",
    );

    expect(numeric.kind).toBe("question");
  });

  it("still refreshes on a membership change", () => {
    // The path this route existed for must not have been disturbed.
    const verdict = classifyUpdate(
      { chat_member: { chat: { username: "ustozai" } } },
      "ustozai",
      CHAT,
    );

    expect(verdict).toEqual({ kind: "refresh" });
  });
});
