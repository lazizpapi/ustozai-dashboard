import { describe, expect, it } from "vitest";

import { WEBHOOK_REFRESH_FLOOR_MS, classifyUpdate } from "./telegram-webhook";
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
    expect(classifyUpdate({ message: { text: "hi" } }, "ustozai")).toMatchObject({
      kind: "ignore",
      reason: "not a chat_member update",
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
