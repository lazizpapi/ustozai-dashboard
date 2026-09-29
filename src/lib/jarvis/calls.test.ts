import { describe, expect, it } from "vitest";

import { callLength, parseJarvisCall, recordJarvisCall, type JarvisCall } from "./calls";

/**
 * The record Jarvis leaves when a call ends.
 *
 * Once colleagues talk to Jarvis, "who asked what, and when" is the only way
 * to notice a misuse or answer "did Jarvis really say that". The agent posts
 * the record; this checks it before anything is stored, because the agent's
 * process is the least trusted thing that writes to the database.
 */

const VALID = {
  room: "jarvis_marketing_ab12cd",
  identity: "marketing_ab12cd",
  role: "marketing",
  caller_name: "Marketing",
  started_at: "2026-09-29T09:00:00.000Z",
  duration_s: 184,
  tools_used: ["get_keywords", "search_the_web"],
  input_tokens: 5120,
  output_tokens: 640,
  close_reason: "user_initiated",
  summary: "Keyword ranks for the last week; opened the Keywords page.",
};

describe("parseJarvisCall", () => {
  it("accepts a complete record", () => {
    const parsed = parseJarvisCall(VALID);
    expect(parsed).toEqual({ ok: true, call: VALID });
  });

  it("fills in the parts a short call may not have", () => {
    const parsed = parseJarvisCall({
      room: VALID.room,
      identity: VALID.identity,
      role: "ceo",
      started_at: VALID.started_at,
      duration_s: 3,
    });
    expect(parsed).toMatchObject({
      ok: true,
      call: { caller_name: "", tools_used: [], input_tokens: 0, output_tokens: 0, close_reason: "", summary: "" },
    });
  });

  it.each([
    ["an unknown department", { role: "admin" }],
    ["a negative duration", { duration_s: -1 }],
    ["a duration of more than a day", { duration_s: 86_401 }],
    ["a summary longer than two thousand characters", { summary: "x".repeat(2001) }],
    ["a start that is not a timestamp", { started_at: "yesterday" }],
    ["a tool name that is not a name", { tools_used: [""] }],
  ])("refuses %s", (_, change) => {
    expect(parseJarvisCall({ ...VALID, ...change }).ok).toBe(false);
  });

  it("refuses something that is not an object", () => {
    expect(parseJarvisCall(null).ok).toBe(false);
  });
});

describe("recordJarvisCall", () => {
  it("stores a valid record", async () => {
    const saved: JarvisCall[] = [];
    const result = await recordJarvisCall(VALID, async (call) => {
      saved.push(call);
    });
    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(saved).toEqual([VALID]);
  });

  it("stores nothing and says why when the record is malformed", async () => {
    const saved: JarvisCall[] = [];
    const result = await recordJarvisCall({ ...VALID, role: "admin" }, async (call) => {
      saved.push(call);
    });
    expect(result.status).toBe(400);
    expect(saved).toEqual([]);
  });

  it("reports a failed save as a server error", async () => {
    const result = await recordJarvisCall(VALID, async () => {
      throw new Error("database is down");
    });
    expect(result).toEqual({ status: 500, body: { ok: false, error: "database is down" } });
  });
});

describe("callLength", () => {
  it.each([
    [0, "0 s"],
    [42, "42 s"],
    [60, "1 min"],
    [184, "3 min 4 s"],
    [3725, "1 h 2 min"],
  ])("reads %i seconds as %j", (seconds, text) => {
    expect(callLength(seconds)).toBe(text);
  });
});

