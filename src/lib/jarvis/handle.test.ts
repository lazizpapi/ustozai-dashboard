import { describe, expect, it } from "vitest";

import { ASK_TOOLS, toolNames, type AskFunctionTool } from "@/lib/analyst/tools";
import { pagesFor, toolsFor } from "./authority";
import {
  ACTION_TOOLS,
  argsFromBody,
  flagEnabled,
  handleJarvis,
  jarvisCatalogue,
  type JarvisCatalogue,
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
    const result = await handleJarvis({ role: "ceo", tool: "get_revenue", method: "GET", args: {} }, d);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, tool: "get_revenue" });
    expect(d.calls).toEqual([["get_revenue", { days: 30 }]]);
  });

  it("echoes back the arguments it actually used, not the ones asked for", async () => {
    // Jarvis speaks the answer out loud and has to name the period. If the
    // request said a hundred thousand days and the query ran over 365, the
    // spoken sentence must be able to say 365.
    const result = await handleJarvis(
      { role: "ceo", tool: "get_revenue", method: "GET", args: { days: 100000 } },
      deps(),
    );
    expect(result.body).toMatchObject({ args: { days: 365 } });
  });

  it("refuses a tool it does not know, and says which exist", async () => {
    const d = deps();
    const result = await handleJarvis({ role: "ceo", tool: "get_profits", method: "GET", args: {} }, d);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ tools: ["get_revenue", "get_reviews", "get_growth"] });
    expect(d.calls).toEqual([]);
  });

  it("reports a failing query as a server error rather than as an answer", async () => {
    // A tool that throws must never come back as 200 with an empty body: Jarvis
    // would read "revenue is nothing" aloud, which is a different sentence from
    // "I cannot reach the dashboard".
    const result = await handleJarvis(
      { role: "ceo", tool: "get_revenue", method: "GET", args: {} },
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

describe("who is asking", () => {
  const readable = ["get_revenue", "get_reviews", "get_growth"];

  it("refuses a request that does not say who is asking", async () => {
    const d = deps();
    const result = await handleJarvis({ role: null, tool: "get_growth", method: "GET", args: {} }, d);

    expect(result.status).toBe(403);
    expect(d.calls).toEqual([]);
  });

  it("refuses a read outside the caller's department and names what they may use", async () => {
    const d = deps();
    const result = await handleJarvis(
      { role: "marketing", tool: "get_revenue", method: "GET", args: {} },
      d,
    );

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ ok: false, tools: toolsFor("marketing", readable) });
    expect(d.calls).toEqual([]);
  });

  it("still answers 400 for a tool nobody has, listing only the caller's tools", async () => {
    const result = await handleJarvis(
      { role: "marketing", tool: "get_profits", method: "GET", args: {} },
      deps(),
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ tools: toolsFor("marketing", readable) });
  });

  it("runs the query as the caller, so what it returns can be cut to their department", async () => {
    const asked: unknown[] = [];
    const d = deps({ runTool: async (_name, _args, role) => (asked.push(role), {}) });
    await handleJarvis({ role: "product", tool: "get_growth", method: "GET", args: {} }, d);
    expect(asked).toEqual(["product"]);
  });

  it("refuses a department's post even with actions switched on", async () => {
    const sent: unknown[][] = [];
    const d = deps({
      actionsEnabled: true,
      runAction: async (...args) => (sent.push(args), { status: 200, body: {} }),
    });
    const result = await handleJarvis(
      { role: "marketing", tool: "send_telegram", method: "POST", args: { text: "hi" } },
      d,
    );
    expect(result.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("lets a department post once it is named as a poster", async () => {
    const d = deps({
      actionsEnabled: true,
      postingRoles: ["ceo", "marketing"],
      runAction: async () => ({ status: 200, body: { ok: true, sent: true } }),
    });
    const result = await handleJarvis(
      { role: "marketing", tool: "send_telegram", method: "POST", args: { text: "hi" } },
      d,
    );
    expect(result.status).toBe(200);
  });
});

describe("arguments arriving from a query string", () => {
  it("reads a numeric parameter as a number", async () => {
    // A GET gives every value as a string, and the clamp only recognises
    // numbers. Without this, ?days=7 would silently fall back to 30 and Jarvis
    // would answer a question nobody asked.
    const d = deps();
    await handleJarvis({ role: "ceo", tool: "get_revenue", method: "GET", args: { days: "7" } }, d);
    expect(d.calls).toEqual([["get_revenue", { days: 7 }]]);
  });

  it("leaves a genuinely textual parameter alone", async () => {
    const d = deps();
    await handleJarvis(
      { role: "ceo", tool: "get_growth", method: "GET", args: { metric: "telegram", period: "week" } },
      d,
    );
    expect(d.calls).toEqual([["get_growth", { metric: "telegram", period: "week" }]]);
  });

  it("does not turn an empty or whitespace value into zero", async () => {
    // Number("") is 0, which would clamp to 1 day and quietly answer about
    // yesterday when the caller meant to omit the parameter.
    const d = deps();
    await handleJarvis({ role: "ceo", tool: "get_revenue", method: "GET", args: { days: "" } }, d);
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
    const result = await handleJarvis({ role: "ceo", tool: "remember_fact", method: "POST", args: {} }, d);

    expect(result.status).toBe(400);
    expect(d.calls).toEqual([]);
  });

  it("answers every action with not-implemented while the switch is off", async () => {
    // With JARVIS_ACTIONS_ENABLED unset the route is read-only by
    // construction: no branch reaches a send. This test is what makes that
    // claim checkable rather than a comment.
    for (const tool of ACTION_TOOLS) {
      const sent: unknown[][] = [];
      const d = deps({ runAction: async (...args) => (sent.push(args), { status: 200, body: {} }) });
      const result = await handleJarvis({ role: "ceo", tool, method: "POST", args: { text: "hi" } }, d);
      expect(result.status).toBe(501);
      expect(d.calls).toEqual([]);
      expect(sent).toEqual([]);
    }
  });

  it("refuses to act on a GET even when the switch is on", async () => {
    // A GET is what a prefetching proxy or a pasted link sends. Posting to the
    // company chat must take a deliberate POST.
    const sent: unknown[][] = [];
    const d = deps({
      actionsEnabled: true,
      runAction: async (...args) => (sent.push(args), { status: 200, body: {} }),
    });
    const result = await handleJarvis({ role: "ceo", tool: "send_report", method: "GET", args: {} }, d);
    expect(result.status).toBe(405);
    expect(sent).toEqual([]);
  });

  it("hands a POST to the action runner when the switch is on", async () => {
    const sent: unknown[][] = [];
    const d = deps({
      actionsEnabled: true,
      runAction: async (...args) => (sent.push(args), { status: 200, body: { ok: true, sent: true } }),
    });
    const result = await handleJarvis(
      { role: "ceo", tool: "send_telegram", method: "POST", args: { text: "hello" } },
      d,
    );
    expect(result).toEqual({ status: 200, body: { ok: true, sent: true } });
    expect(sent).toEqual([["send_telegram", { text: "hello" }]]);
  });

  it("reports an action that throws as a server error, not as sent", async () => {
    const d = deps({
      actionsEnabled: true,
      runAction: async () => {
        throw new Error("database is down");
      },
    });
    const result = await handleJarvis({ role: "ceo", tool: "send_report", method: "POST", args: {} }, d);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, error: "database is down" });
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

describe("the catalogue", () => {
  const readTools = ASK_TOOLS as AskFunctionTool[];

  function catalogue(actionsEnabled = false): JarvisCatalogue {
    const result = jarvisCatalogue(readTools, { actionsEnabled, role: "ceo" });
    expect(result.status).toBe(200);
    return result.body as JarvisCatalogue;
  }

  /** Every enum anywhere in a schema, however deeply nested. */
  function enumsIn(schema: unknown): unknown[][] {
    if (schema === null || typeof schema !== "object") return [];
    const node = schema as Record<string, unknown>;
    const own = Array.isArray(node.enum) ? [node.enum] : [];
    return [...own, ...Object.values(node).flatMap((value) => enumsIn(value))];
  }

  it("describes every read tool, in order, with its parameters", () => {
    const body = catalogue();
    expect(body.ok).toBe(true);
    expect(body.tools.map((tool) => tool.name)).toEqual(toolNames());
    for (const tool of body.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toMatchObject({ type: "object" });
    }
  });

  it("hands over plain JSON schema, not OpenAI's function wrapper", () => {
    // Jarvis turns each entry into a Gemini function declaration, whose schema
    // type forbids unknown keys. `strict` and `type: "function"` belong to the
    // OpenAI envelope and would end the voice session at connect.
    for (const tool of catalogue().tools) {
      expect(Object.keys(tool).sort()).toEqual(["description", "name", "parameters"]);
      expect(tool.parameters).not.toHaveProperty("strict");
    }
  });

  it("gives a tool without parameters an empty object schema rather than nothing", () => {
    const bare = {
      type: "function",
      name: "get_nothing",
      description: "Takes no arguments.",
      parameters: null,
      strict: false,
    } as AskFunctionTool;
    const body = jarvisCatalogue([bare], { actionsEnabled: false, role: "ceo" }).body as JarvisCatalogue;
    expect(body.tools[0].parameters).toEqual({ type: "object", properties: {} });
  });

  it("uses only text enums, which is all a Gemini schema accepts", () => {
    for (const tool of catalogue().tools) {
      for (const values of enumsIn(tool.parameters)) {
        for (const value of values) expect(typeof value).toBe("string");
      }
    }
  });

  it.each(["session", "calls", "notes", "context", "briefing"])(
    "never names a tool %j, because that path is a route of its own",
    (reserved) => {
      expect(catalogue().tools.map((tool) => tool.name)).not.toContain(reserved);
    },
  );

  it("says actions are off unless the flag turns them on", () => {
    expect(catalogue(false).actions).toEqual({ enabled: false, tools: [...ACTION_TOOLS] });
    expect(catalogue(true).actions).toEqual({ enabled: true, tools: [...ACTION_TOOLS] });
  });
});

describe("the catalogue for one caller", () => {
  const readTools = ASK_TOOLS as AskFunctionTool[];

  it("describes only the tools the caller's department may use", () => {
    const body = jarvisCatalogue(readTools, { actionsEnabled: false, role: "marketing" })
      .body as JarvisCatalogue;
    expect(body.tools.map((tool) => tool.name)).toEqual(toolsFor("marketing", toolNames()));
  });

  it("reports actions off for a department that may not post, even with the switch on", () => {
    const body = jarvisCatalogue(readTools, { actionsEnabled: true, role: "product" })
      .body as JarvisCatalogue;
    expect(body.actions.enabled).toBe(false);
  });

  it("lists the pages the caller may be shown", () => {
    const body = jarvisCatalogue(readTools, { actionsEnabled: false, role: "it" })
      .body as JarvisCatalogue;
    expect(body.pages).toEqual(pagesFor("it"));
  });

  it("refuses to describe anything without a caller", () => {
    expect(jarvisCatalogue(readTools, { actionsEnabled: false, role: null }).status).toBe(403);
  });
});

describe("a feature switch", () => {
  it("is on only when set to true", () => {
    expect(flagEnabled("true")).toBe(true);
    expect(flagEnabled(" TRUE ")).toBe(true);
  });

  it("stays off when unset, empty, false or anything else", () => {
    // Off by default is the point: a deploy that forgets the variable must not
    // quietly hand Jarvis the power to post or to sign in.
    for (const value of [undefined, "", "false", "0", "yes", "on"]) {
      expect(flagEnabled(value)).toBe(false);
    }
  });
});
