import { describe, expect, it } from "vitest";

import { callContext, gatherCallContext, tashkentDate } from "./context";
import type { JarvisNote } from "./notes";

// 09:00 in Tashkent (UTC+5) on Tuesday 29 September 2026.
const NOW = new Date("2026-09-29T04:00:00Z");

const note = (id: string, due_on: string | null, text = `note ${id}`): JarvisNote => ({
  id,
  text,
  due_on,
  created_at: "2026-09-20T10:00:00.000Z",
});

describe("tashkentDate", () => {
  it("is the calendar day in Tashkent, not in UTC", () => {
    expect(tashkentDate(new Date("2026-09-28T19:30:00Z"))).toBe("2026-09-29");
    expect(tashkentDate(new Date("2026-09-28T18:59:00Z"))).toBe("2026-09-28");
  });
});

describe("callContext", () => {
  it("marks the first call of the day when the department has not called since midnight in Tashkent", () => {
    const yesterday = [{ started_at: "2026-09-28T13:00:00Z", summary: "Asked: installs" }];
    expect(callContext({ now: NOW, calls: yesterday, notes: [] }).firstCallToday).toBe(true);

    const justAfterMidnight = [{ started_at: "2026-09-28T19:30:00Z", summary: "Asked: revenue" }];
    expect(callContext({ now: NOW, calls: justAfterMidnight, notes: [] }).firstCallToday).toBe(
      false,
    );
  });

  it("keeps the three latest calls with something to say, newest first", () => {
    const calls = [
      { started_at: "2026-09-25T10:00:00Z", summary: "Asked: one" },
      { started_at: "2026-09-28T10:00:00Z", summary: "Asked: four" },
      { started_at: "2026-09-26T10:00:00Z", summary: "" },
      { started_at: "2026-09-27T10:00:00Z", summary: "Asked: three" },
      { started_at: "2026-09-26T09:00:00Z", summary: "Asked: two" },
    ];
    expect(callContext({ now: NOW, calls, notes: [] }).recentCalls.map((c) => c.summary)).toEqual([
      "Asked: four",
      "Asked: three",
      "Asked: two",
    ]);
  });

  it("lists reminders due today or earlier, oldest first, and leaves plain notes out", () => {
    const notes = [
      note("a", "2026-10-02"),
      note("b", "2026-09-29"),
      note("c", null),
      note("d", "2026-09-27"),
    ];
    expect(callContext({ now: NOW, calls: [], notes }).dueReminders.map((n) => n.id)).toEqual([
      "d",
      "b",
    ]);
  });

  it("says what day it is in Tashkent, so due days are read the same way", () => {
    expect(callContext({ now: NOW, calls: [], notes: [] }).today).toBe("2026-09-29");
  });
});

describe("gatherCallContext", () => {
  const calls = async () => [{ started_at: "2026-09-28T13:00:00Z", summary: "Asked: installs" }];
  const notes = async () => [note("due", "2026-09-29")];
  const broken = async (): Promise<never> => {
    throw new Error("relation does not exist");
  };

  it("reads the calls and the notes of the caller's department", async () => {
    const seen: string[] = [];
    const result = await gatherCallContext("product", {
      now: NOW,
      calls: async (role) => (seen.push(role), calls()),
      notes: async (role) => (seen.push(role), notes()),
    });
    expect(seen).toEqual(["product", "product"]);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, firstCallToday: true });
  });

  it("keeps the call memory when the notes cannot be read", async () => {
    const result = await gatherCallContext("ceo", { now: NOW, calls, notes: broken });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      dueReminders: [],
      recentCalls: [{ summary: "Asked: installs" }],
    });
  });

  it("does not offer the briefing again when the call log cannot be read", async () => {
    const result = await gatherCallContext("ceo", { now: NOW, calls: broken, notes });
    expect(result.body).toMatchObject({ ok: true, firstCallToday: false, recentCalls: [] });
  });

  it("fails only when neither can be read", async () => {
    const result = await gatherCallContext("ceo", { now: NOW, calls: broken, notes: broken });
    expect(result.status).toBe(500);
  });
});
