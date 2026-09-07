import { describe, expect, it } from "vitest";

import { toolNames } from "@/lib/analyst/tools";
import {
  ACTION_TOOLS,
  argsFromBody,
  handleJarvis,
  jarvisIndex,
  type JarvisDeps,
} from "./handle";

/**
 * What Jarvis is allowed to ask the dashboard for.
 *
 * Jarvis is a voice assistant on one laptop, and the words reaching it come
 * from a microphone in a room. So the same rule as the chat agent applies with
 * less margin: the caller chooses the tool and the arguments, and both are
 * untrusted. Everything here defends that boundary.
 *
 * The deps are injected rather than mocked, which keeps this file away from
 * the database entirely — it tests dispatch, not queries.
 */

function deps(overrides: Partial<JarvisDeps> = {}): JarvisDeps & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    readToolNames: () => ["get_revenue", "get_reviews", "get_growth"],
    clampArgs: (tool, raw) => {
      // A stand-in with the one behaviour the handler depends on: it bounds a
      // number. The real clamping is pinned in tools.test.ts.
      const args = (raw ?? {}) as Record<string, unknown>;
      if (tool === "get_revenue") {
        const days = typeof args.days === "number" ? args.days : 30;
        return { days: Math.min(365, Math.max(1, Math.round(days))) };
      }
      return args;
    },
    runTool: async (name, args) => {
      calls.push([name, args]);
      return { ok: name };
    },
    ...overrides,
  };
}

describe("dispatch", () => {
  it("runs a read tool and returns its data", async () => {
    const d = deps();
    const result = await handleJarvis({ tool: "get_revenue", method: "GET", args: {} }, d);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, tool: "get_revenue" });
    expect(d.calls).toEqual([["get_revenue", { days: 30 }]]);
  });

  it("echoes back the arguments it actually used, not the ones asked for", async () => {
    // Jarvis speaks the answer out loud and has to name the period. If the
    // request said a hundred thousand days and the query ran over 365, the
    // spoken sentence must be able to say 365.
    const result = await handleJarvis(
      { tool: "get_revenue", method: "GET", args: { days: 100000 } },
      deps(),
    );
    expect(result.body).toMatchObject({ args: { days: 365 } });
  });

  it("refuses a tool it does not know, and says which exist", async () => {
    const d = deps();
    const result = await handleJarvis({ tool: "get_profits", method: "GET", args: {} }, d);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ tools: ["get_revenue", "get_reviews", "get_growth"] });
    expect(d.calls).toEqual([]);
  });

  it("reports a failing query as a server error rather than as an answer", async () => {
    // A tool that throws must never come back as 200 with an empty body: Jarvis
    // would read "revenue is nothing" aloud, which is a different sentence from
    // "I cannot reach the dashboard".
    const result = await handleJarvis(
      { tool: "get_revenue", method: "GET", args: {} },
      deps({
        runTool: async () => {
          throw new Error("supabase unreachable");
        },
      }),
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false });
  });
});

describe("arguments arriving from a query string", () => {
  it("reads a numeric parameter as a number", async () => {
    // A GET gives every value as a string, and the clamp only recognises
    // numbers. Without this, ?days=7 would silently fall back to 30 and Jarvis
    // would answer a question nobody asked.
    const d = deps();
    await handleJarvis({ tool: "get_revenue", method: "GET", args: { days: "7" } }, d);
    expect(d.calls).toEqual([["get_revenue", { days: 7 }]]);
  });

  it("leaves a genuinely textual parameter alone", async () => {
    const d = deps();
    await handleJarvis(
      { tool: "get_growth", method: "GET", args: { metric: "telegram", period: "week" } },
      d,
    );
    expect(d.calls).toEqual([["get_growth", { metric: "telegram", period: "week" }]]);
  });

  it("does not turn an empty or whitespace value into zero", async () => {
    // Number("") is 0, which would clamp to 1 day and quietly answer about
    // yesterday when the caller meant to omit the parameter.
    const d = deps();
    await handleJarvis({ tool: "get_revenue", method: "GET", args: { days: "" } }, d);
    expect(d.calls).toEqual([["get_revenue", { days: 30 }]]);
  });
});

describe("the write boundary", () => {
  it("does not expose the one tool that writes", () => {
    // remember_fact lives in CHAT_TOOLS, where a person is present to have
    // consented. Jarvis is handed ASK_TOOLS, and this is the assertion that
    // notices if that ever changes.
    expect(toolNames()).not.toContain("remember_fact");
    expect(toolNames()).toHaveLength(15);
  });

  it("refuses remember_fact even though runTool would happily perform it", async () => {
    const d = deps();
    const result = await handleJarvis({ tool: "remember_fact", method: "POST", args: {} }, d);

    expect(result.status).toBe(400);
    expect(d.calls).toEqual([]);
  });

  it("answers every action with not-implemented, because none are built yet", async () => {
    // The deployed route is read-only by construction: there is no branch here
    // that reaches a send. This test is what makes that claim checkable rather
    // than a comment.
    for (const tool of ACTION_TOOLS) {
      const d = deps();
      const result = await handleJarvis({ tool, method: "POST", args: { text: "hi" } }, d);
      expect(result.status).toBe(501);
      expect(d.calls).toEqual([]);
    }
  });
});

describe("a POST body", () => {
  it("treats an absent body as no arguments", () => {
    // Found by hand against a running server: a POST with no body made the
    // route answer "body must be valid JSON" before it ever looked at which
    // tool was asked for, so an action came back 400 instead of 501.
    expect(argsFromBody("")).toEqual({ ok: true, args: {} });
    expect(argsFromBody("   \n ")).toEqual({ ok: true, args: {} });
  });

  it("takes the object as the arguments, with no envelope", () => {
    expect(argsFromBody('{"days":7}')).toEqual({ ok: true, args: { days: 7 } });
  });

  it("refuses anything that is not an object", () => {
    // An array or a bare string is a caller bug. Reading it as empty would
    // answer with defaults instead of saying the request was malformed.
    expect(argsFromBody("[1,2]").ok).toBe(false);
    expect(argsFromBody('"seven"').ok).toBe(false);
    expect(argsFromBody("null").ok).toBe(false);
  });

  it("refuses invalid JSON", () => {
    expect(argsFromBody("{days:7}").ok).toBe(false);
  });
});

describe("the index", () => {
  it("lists the readable tools and says actions are off", () => {
    const result = jarvisIndex(deps());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      tools: ["get_revenue", "get_reviews", "get_growth"],
      actions: { enabled: false },
    });
  });
});
