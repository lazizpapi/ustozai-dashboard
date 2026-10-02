import { describe, expect, it } from "vitest";

import {
  callLength,
  isFailedStart,
  parseJarvisCall,
  recordJarvisCall,
  tokenCount,
  unusualEnding,
  withoutShadowedFailures,
  type JarvisCall,
} from "./calls";

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


describe("how a call ended, when it matters", () => {
  it("names the endings worth noticing", () => {
    expect(unusualEnding("time_limit")).toBe("Reached the time limit");
    expect(unusualEnding("second_person")).toBe("Someone else joined");
    expect(unusualEnding("error")).toBe("Ended by an error");
  });

  it("says nothing about an ordinary goodbye or hang-up", () => {
    for (const reason of ["", "user_initiated", "participant_disconnected", "job_shutdown", "task_completed"]) {
      expect(unusualEnding(reason)).toBeNull();
    }
  });
});

describe("calls that never got going", () => {
  it("names each way a call can fail to start", () => {
    expect(unusualEnding("never_joined")).toBe("Jarvis never joined");
    expect(unusualEnding("not_ready")).toBe("Jarvis joined but never got ready");
    expect(unusualEnding("dropped")).toBe("Jarvis dropped out");
    expect(unusualEnding("gave_up")).toBe("Caller gave up waiting");
    expect(unusualEnding("no_microphone")).toBe("Microphone was unavailable");
  });

  it("tells a failed start from a call that happened, however it ended", () => {
    expect(isFailedStart("never_joined")).toBe(true);
    expect(isFailedStart("gave_up")).toBe(true);
    expect(isFailedStart("no_microphone")).toBe(true);
    for (const reason of ["", "user_initiated", "time_limit", "error"]) expect(isFailedStart(reason)).toBe(false);
  });

  it("hides a failed start when Jarvis recorded the same call itself", () => {
    // The screen gave up just as Jarvis got going: Jarvis's own record wins.
    const rows = [
      { id: "1", room: "jarvis_ceo_aa", closeReason: "user_initiated" },
      { id: "2", room: "jarvis_ceo_aa", closeReason: "gave_up" },
      { id: "3", room: "jarvis_ceo_bb", closeReason: "never_joined" },
      { id: "4", room: "jarvis_ceo_cc", closeReason: "" },
    ];
    expect(withoutShadowedFailures(rows).map((row) => row.id)).toEqual(["1", "3", "4"]);
  });
});

describe("tokens", () => {
  it("reads large counts the way the page shows them", () => {
    expect(tokenCount(0)).toBe("0");
    expect(tokenCount(950)).toBe("950");
    expect(tokenCount(12_400)).toBe("12.4k");
    expect(tokenCount(1_250_000)).toBe("1.3M");
  });
});
