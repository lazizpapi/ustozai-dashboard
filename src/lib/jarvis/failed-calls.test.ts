import { describe, expect, it } from "vitest";

import type { JarvisCall } from "./calls";
import { recordFailedCall, type FailedCallInput } from "./failed-calls";

/**
 * A call that never got going: the caller pressed Talk and Jarvis never
 * joined, never got ready, dropped out, or the caller gave up waiting.
 *
 * Jarvis cannot record these itself, because it was never there. The call
 * screen reports them, so the CEO's Calls page shows a colleague's failed
 * first try instead of nothing (1 October 2026: Jarvis joined about a second
 * after the page had given up, and no trace was left anywhere).
 */

const NOW = new Date("2026-10-02T09:00:00.000Z");

function input(overrides: Partial<FailedCallInput> = {}) {
  const saved: JarvisCall[] = [];
  const result = recordFailedCall({
    role: "marketing",
    scope: "person",
    body: {
      room: "jarvis_marketing_c14ed7e9",
      identity: "marketing_c14ed7e9",
      reason: "never_joined",
      waited_s: 60,
      person: "Dilnoza",
    },
    now: NOW,
    alreadyLogged: async () => false,
    failuresLately: async () => 0,
    save: async (call) => {
      saved.push(call);
    },
    ...overrides,
  });
  return { result, saved };
}

describe("recordFailedCall", () => {
  it("stores the failed call under the caller's department, with how long they waited", async () => {
    const { result, saved } = input();
    expect((await result).status).toBe(200);
    expect(saved).toEqual([
      {
        room: "jarvis_marketing_c14ed7e9",
        identity: "marketing_c14ed7e9",
        role: "marketing",
        caller_name: "Dilnoza (Marketing)",
        started_at: "2026-10-02T08:59:00.000Z",
        duration_s: 0,
        tools_used: [],
        input_tokens: 0,
        output_tokens: 0,
        close_reason: "never_joined",
        summary: "Waited 1 min for Jarvis.",
      },
    ]);
  });

  it("names the department alone when the caller gave no usable name", async () => {
    const { result, saved } = input({
      body: {
        room: "jarvis_marketing_c14ed7e9",
        identity: "marketing_c14ed7e9",
        reason: "gave_up",
        waited_s: 9,
        person: "<b>x</b>",
      },
    });
    await result;
    expect(saved[0]?.caller_name).toBe("Marketing");
    expect(saved[0]?.summary).toBe("Gave up after waiting 9 s for Jarvis.");
  });

  it("refuses anyone who is not signed in as a person", async () => {
    expect((await input({ role: null }).result).status).toBe(401);
    expect((await input({ scope: "jarvis" }).result).status).toBe(403);
  });

  it("refuses a call that belongs to another department", async () => {
    // Marketing cannot write a failed call into the CEO's log.
    const { result, saved } = input({
      body: { room: "jarvis_ceo_c14ed7e9", identity: "ceo_c14ed7e9", reason: "never_joined", waited_s: 60 },
    });
    expect((await result).status).toBe(400);
    expect(saved).toEqual([]);
  });

  it("refuses a room and identity from two different calls, or an unknown reason", async () => {
    const mismatched = input({
      body: { room: "jarvis_marketing_c14ed7e9", identity: "marketing_00000000", reason: "never_joined", waited_s: 60 },
    });
    expect((await mismatched.result).status).toBe(400);
    const unknown = input({
      body: { room: "jarvis_marketing_c14ed7e9", identity: "marketing_c14ed7e9", reason: "bored", waited_s: 60 },
    });
    expect((await unknown.result).status).toBe(400);
    expect([...mismatched.saved, ...unknown.saved]).toEqual([]);
  });

  it("stores a call once, however many times the screen reports it", async () => {
    const { result, saved } = input({ alreadyLogged: async () => true });
    expect((await result).status).toBe(200);
    expect(saved).toEqual([]);
  });

  it("stops storing after ten failed calls from one department in ten minutes", async () => {
    const { result, saved } = input({ failuresLately: async () => 10 });
    expect((await result).status).toBe(429);
    expect(saved).toEqual([]);
  });
});
