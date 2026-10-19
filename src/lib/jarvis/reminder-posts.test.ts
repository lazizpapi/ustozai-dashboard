import { describe, expect, it, vi } from "vitest";

import {
  MAX_POSTS,
  TELEGRAM_LIMIT,
  doneNoteId,
  isPostingHour,
  postDueReminders,
  reminderMessage,
  reminderBatches,
  remindersToPost,
  type PostDeps,
  type ReminderRow,
} from "./reminder-posts";

/**
 * Reminders a department saved with Jarvis, posted to the team's Telegram
 * group on the day they fall due, at 9:00 Tashkent, so nobody has to call
 * Jarvis to hear them. Decided with Lazizbek on 19 October 2026: the team
 * group, one Uzbek message per department, never the CEO's, a "Bajarildi"
 * button that clears one, and at most three mornings for one nobody clears.
 */

// 09:00 Tashkent on Monday 19 October 2026 is 04:00 UTC.
const NINE = new Date("2026-10-19T04:00:12Z");
const TODAY = "2026-10-19";

const row = (id: string, overrides: Partial<ReminderRow> = {}): ReminderRow => ({
  id,
  role: "marketing",
  text: `reminder ${id}`,
  due_on: TODAY,
  created_at: "2026-10-15T08:00:00Z",
  post_count: 0,
  last_posted_on: null,
  cleared_at: null,
  cleared_by: null,
  ...overrides,
});

describe("isPostingHour", () => {
  it("is the poll that runs at 9:00 in Tashkent, and no other", () => {
    expect(isPostingHour(NINE)).toBe(true);
    expect(isPostingHour(new Date("2026-10-19T04:59:00Z"))).toBe(true);
    expect(isPostingHour(new Date("2026-10-19T03:00:00Z"))).toBe(false);
    expect(isPostingHour(new Date("2026-10-19T05:00:00Z"))).toBe(false);
  });
});

describe("remindersToPost", () => {
  it("takes the open reminders due today or earlier, by department", () => {
    const due = remindersToPost(
      [
        row("m1"),
        row("p1", { role: "product", due_on: "2026-10-18" }),
        row("later", { due_on: "2026-10-20" }),
        row("note", { due_on: null }),
        row("done", { cleared_at: "2026-10-19T03:00:00Z" }),
      ],
      TODAY,
    );
    expect([...due.entries()].map(([role, rows]) => [role, rows.map((r) => r.id)])).toEqual([
      ["marketing", ["m1"]],
      ["product", ["p1"]],
    ]);
  });

  it("never posts the CEO's, which may be personal", () => {
    expect(remindersToPost([row("c1", { role: "ceo" })], TODAY).size).toBe(0);
  });

  it("posts one at most once a morning, and on three mornings at most", () => {
    const due = remindersToPost(
      [
        row("today", { last_posted_on: TODAY, post_count: 1 }),
        row("spent", { post_count: MAX_POSTS, last_posted_on: "2026-10-18" }),
        row("again", { post_count: 2, last_posted_on: "2026-10-18" }),
      ],
      TODAY,
    );
    expect(due.get("marketing")?.map((r) => r.id)).toEqual(["again"]);
  });

  it("lists the oldest due first, in the order departments always appear", () => {
    const due = remindersToPost(
      [
        row("it1", { role: "it" }),
        row("new", { due_on: TODAY }),
        row("old", { due_on: "2026-10-17" }),
        row("p1", { role: "product" }),
      ],
      TODAY,
    );
    expect([...due.keys()]).toEqual(["marketing", "product", "it"]);
    expect(due.get("marketing")?.map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("reminderMessage", () => {
  it("is in Uzbek, names the department, keeps each reminder's text, and has a button each", () => {
    const message = reminderMessage("marketing", [
      row("a", { text: "Check the keyword ranks", post_count: 1 }),
      row("b", { text: "Kalit soʻzlarni <yangilash> & tekshirish", post_count: 2 }),
    ]);
    expect(message.text).toBe(
      "⏰ <b>Marketing uchun bugungi eslatmalar</b>\n\n" +
        "1. Check the keyword ranks\n" +
        "2. Kalit soʻzlarni &lt;yangilash&gt; &amp; tekshirish <i>(qayta)</i>",
    );
    expect(message.keyboard).toEqual([
      [{ text: "Bajarildi ✓ 1", callback_data: "done:a" }],
      [{ text: "Bajarildi ✓ 2", callback_data: "done:b" }],
    ]);
  });

  it("shows a ticked-off reminder struck through with who did it, and keeps its place", () => {
    const message = reminderMessage("product", [
      row("a", { role: "product", text: "Reply to reviews", post_count: 1, cleared_at: "x", cleared_by: "Aziza" }),
      row("b", { role: "product", text: "Check installs", post_count: 1 }),
    ]);
    expect(message.text).toBe(
      "⏰ <b>Product uchun bugungi eslatmalar</b>\n\n" +
        "1. ✓ <s>Reply to reviews</s> <i>(Aziza)</i>\n" +
        "2. Check installs",
    );
    // The ticked one keeps a button, so a second tap can be told it is done.
    expect(message.keyboard).toEqual([
      [{ text: "✓ 1", callback_data: "done:a" }],
      [{ text: "Bajarildi ✓ 2", callback_data: "done:b" }],
    ]);
  });

  it("says when everything is done", () => {
    const message = reminderMessage("it", [row("a", { role: "it", text: "Rotate the key", cleared_at: "x" })]);
    expect(message.text).toBe(
      "⏰ <b>IT uchun bugungi eslatmalar</b>\n\n1. ✓ <s>Rotate the key</s>\n\nHammasi bajarildi ✓",
    );
  });
});

describe("reminderBatches", () => {
  it("splits a department's many reminders into messages Telegram will always take, even redrawn", () => {
    const long = Array.from({ length: 30 }, (_, i) => row(`r${i}`, { text: `${"x".repeat(495)} ${i}`, post_count: 1 }));
    const batches = reminderBatches(long);
    expect(batches.flat().map((r) => r.id)).toEqual(long.map((r) => r.id));
    for (const batch of batches) {
      expect(reminderMessage("marketing", batch).text.length).toBeLessThan(TELEGRAM_LIMIT);
      // Every one ticked off by someone with a long name: the redraw must still fit.
      const done = batch.map((r) => ({ ...r, cleared_at: "x", cleared_by: "N".repeat(100) }));
      expect(reminderMessage("marketing", done).text.length).toBeLessThan(TELEGRAM_LIMIT);
    }
  });

  it("keeps a short list in one message", () => {
    expect(reminderBatches([row("a"), row("b")])).toEqual([[row("a"), row("b")]]);
  });

  it("holds ten reminders at most in a message, however short", () => {
    const short = Array.from({ length: 25 }, (_, i) => row(`s${i}`, { text: "ok" }));
    expect(reminderBatches(short).map((batch) => batch.length)).toEqual([10, 10, 5]);
  });
});

describe("doneNoteId", () => {
  it("reads the reminder a button stands for, and nothing else", () => {
    const id = "8c1c2f1e-6a4b-4b8e-9d3a-2f0c7c5e1a90";
    expect(doneNoteId(`done:${id}`)).toBe(id);
    expect(doneNoteId("done:not-an-id")).toBeNull();
    expect(doneNoteId(`delete:${id}`)).toBeNull();
    expect(doneNoteId(42)).toBeNull();
  });
});

describe("postDueReminders", () => {
  function deps(rows: ReminderRow[], overrides: Partial<PostDeps> = {}) {
    const base = {
      now: NINE,
      due: vi.fn<PostDeps["due"]>(async () => rows),
      claim: vi.fn<PostDeps["claim"]>(async () => true),
      unclaim: vi.fn<PostDeps["unclaim"]>(async () => undefined),
      send: vi.fn<PostDeps["send"]>(async () => ({ sent: true })),
    };
    return { ...base, ...overrides } as typeof base;
  }

  it("does nothing outside the 9:00 poll", async () => {
    const d = deps([row("m1")], { now: new Date("2026-10-19T05:00:00Z") });
    expect(await postDueReminders(d)).toEqual({ posted: 0, skipped: "not the 9:00 poll" });
    expect(d.due).not.toHaveBeenCalled();
  });

  it("claims each reminder for today, then posts one message per department", async () => {
    const d = deps([row("m1"), row("p1", { role: "product" })]);
    expect(await postDueReminders(d)).toEqual({ posted: 2, failed: [] });
    expect(d.due).toHaveBeenCalledWith(TODAY);
    expect(d.claim.mock.calls.map(([r, day]) => [r.id, day])).toEqual([
      ["m1", TODAY],
      ["p1", TODAY],
    ]);
    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.send.mock.calls[0][0]).toContain("Marketing uchun");
  });

  it("leaves out one another run already claimed, so a rerun never posts twice", async () => {
    const d = deps([row("m1"), row("m2")], { claim: vi.fn(async (r: ReminderRow) => r.id === "m2") });
    await postDueReminders(d);
    expect(d.send.mock.calls[0][0]).not.toContain("reminder m1");
    expect(d.send.mock.calls[0][0]).toContain("1. reminder m2");
  });

  it("gives the claims back when sending throws, and still posts the next department", async () => {
    const d = deps([row("m1"), row("p1", { role: "product" })], {
      send: vi
        .fn<PostDeps["send"]>()
        .mockRejectedValueOnce(new Error("fetch failed"))
        .mockResolvedValueOnce({ sent: true }),
    });
    expect(await postDueReminders(d)).toEqual({ posted: 1, failed: ["marketing: fetch failed"] });
    expect(d.unclaim).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("skips a department whose claim fails on the database, without losing the others", async () => {
    const d = deps([row("m1"), row("p1", { role: "product" })], {
      claim: vi.fn<PostDeps["claim"]>(async (r) => {
        if (r.id === "m1") throw new Error("database down");
        return true;
      }),
    });
    expect(await postDueReminders(d)).toEqual({ posted: 1, failed: ["marketing: database down"] });
  });

  it("gives the claim back when Telegram does not take the message, so tomorrow can try", async () => {
    const d = deps([row("m1")], { send: vi.fn(async () => ({ sent: false, reason: "Telegram 400" })) });
    expect(await postDueReminders(d)).toEqual({ posted: 0, failed: ["marketing: Telegram 400"] });
    expect(d.unclaim).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });
});
