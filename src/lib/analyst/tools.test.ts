import { describe, expect, it } from "vitest";

import { ASK_TOOLS, CHAT_TOOLS, clampArgs, toolNames, type AskFunctionTool } from "./tools";

/**
 * The tool surface the chat agent is allowed to reach.
 *
 * Everything here defends one boundary: the model chooses which tool to call
 * and what to pass it, so tool inputs are untrusted. They are clamped to
 * ranges the database can serve rather than passed through, because a model
 * that asks for 100,000 days of history should get ten years of nothing, not
 * a timed-out page.
 *
 * The model never writes a query. Each tool maps to one existing, already
 * parameterised function, which is what makes "let it read anything" safe.
 */

describe("the tool catalogue", () => {
  it("gives every tool a description, since that is how the model chooses", () => {
    // A tool the model cannot tell apart from its neighbours is a tool it
    // calls at random, so the description is load-bearing, not documentation.
    for (const tool of ASK_TOOLS as AskFunctionTool[]) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect((tool.description ?? "").length).toBeGreaterThan(40);
      expect((tool.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("has no duplicate names", () => {
    expect(new Set(toolNames()).size).toBe(ASK_TOOLS.length);
  });
});

describe("clampArgs", () => {
  it("caps a runaway day range instead of trusting it", () => {
    expect(clampArgs("get_downloads", { days: 100000 })).toEqual({ days: 365 });
  });

  it("raises a nonsensical low value to the minimum", () => {
    expect(clampArgs("get_downloads", { days: 0 })).toEqual({ days: 1 });
    expect(clampArgs("get_downloads", { days: -5 })).toEqual({ days: 1 });
  });

  it("substitutes the default when the model omits or fumbles the type", () => {
    expect(clampArgs("get_downloads", {})).toEqual({ days: 30 });
    expect(clampArgs("get_downloads", { days: "lots" })).toEqual({ days: 30 });
  });

  it("caps how many reviews can be pulled at once", () => {
    expect(clampArgs("get_reviews", { limit: 5000 })).toMatchObject({ limit: 100 });
  });

  it("rejects a period it does not recognise rather than passing it to the query", () => {
    expect(clampArgs("get_growth", { metric: "telegram", period: "fortnight" })).toMatchObject({
      period: "day",
    });
  });

  it("rejects an unknown growth metric", () => {
    // The metric keys a lookup table. An unrecognised one must not reach it.
    expect(clampArgs("get_growth", { metric: "vibes", period: "week" })).toMatchObject({
      metric: "iosDownloads",
    });
  });

  it("passes a sensible value through untouched", () => {
    expect(clampArgs("get_downloads", { days: 14 })).toEqual({ days: 14 });
  });

  it("returns an empty object for a tool that takes no arguments", () => {
    expect(clampArgs("get_market", { days: 99 })).toEqual({});
  });

  it("does not throw on an unknown tool name", () => {
    // Dispatch rejects it; clamping must not be the thing that crashes first.
    expect(() => clampArgs("drop_everything", { x: 1 })).not.toThrow();
  });
});

describe("the tools that reach past the stores", () => {
  it("clamps the day range on every new tool", () => {
    for (const tool of ["get_revenue", "get_active_users", "get_instagram"]) {
      expect(clampArgs(tool, { days: 99_999 })).toEqual({ days: 365 });
      expect(clampArgs(tool, { days: -5 })).toEqual({ days: 1 });
      expect(clampArgs(tool, {})).toEqual({ days: 30 });
    }
  });

  it("declares each of them with a description", () => {
    const named = Object.fromEntries(
      (ASK_TOOLS as { name: string; description?: string }[]).map((t) => [t.name, t]),
    );

    for (const tool of ["get_revenue", "get_active_users", "get_instagram"]) {
      expect(named[tool]).toBeDefined();
      expect(named[tool].description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it("warns the model off summing Instagram reach", () => {
    // Reach is a unique count. Summing seven days overstates it by about a
    // tenth, which is the single easiest figure here to quote wrongly.
    const instagram = (ASK_TOOLS as { name: string; description?: string }[]).find(
      (t) => t.name === "get_instagram",
    );

    expect(instagram?.description).toMatch(/does not add up|never sum/i);
  });
});

describe("get_metric_notes", () => {
  it("is declared, and says what it is for in the words somebody would ask in", () => {
    const tool = (ASK_TOOLS as { name: string; description?: string }[]).find(
      (t) => t.name === "get_metric_notes",
    );

    expect(tool).toBeDefined();
    // The Uzbek phrasing is in the description on purpose: the Telegram bot is
    // asked "nega o'sdik" far more often than "why did downloads rise".
    expect(tool?.description).toMatch(/nega o'sdik/i);
  });

  it("clamps the window and drops a metric it does not recognise", () => {
    expect(clampArgs("get_metric_notes", { days: 99_999 })).toEqual({ days: 365 });
    expect(clampArgs("get_metric_notes", {})).toEqual({ days: 30 });

    // Dropped rather than defaulted: widening to every metric is honest, and
    // silently answering about a different one is not.
    expect(clampArgs("get_metric_notes", { days: 7, metric: "downloads" })).toEqual({
      days: 7,
    });
    expect(clampArgs("get_metric_notes", { days: 7, metric: "ios_downloads" })).toEqual({
      days: 7,
      metric: "ios_downloads",
    });
  });
});

describe("the write tool", () => {
  it("is offered to the chat", () => {
    const names = (CHAT_TOOLS as { name: string }[]).map((tool) => tool.name);

    expect(names).toContain("remember_fact");
    expect(names).toHaveLength(ASK_TOOLS.length + 1);
  });

  it("is kept out of the read-only list", () => {
    /*
     * The fence, pinned. ASK_TOOLS is what the explainer runs with, and the
     * explainer runs at six in the morning with nobody watching. A write tool
     * reaching that list would mean an unattended model deciding what the
     * company believes, and nothing else in the codebase would complain.
     */
    const names = (ASK_TOOLS as { name: string }[]).map((tool) => tool.name);

    expect(names).not.toContain("remember_fact");
  });

  it("trims and caps the fact, and survives a model sending nothing", () => {
    expect(clampArgs("remember_fact", { fact: "  a fact  " })).toEqual({ fact: "a fact" });
    expect(clampArgs("remember_fact", { fact: "u".repeat(900) }).fact).toHaveLength(500);
    expect(clampArgs("remember_fact", {})).toEqual({ fact: "" });
    expect(clampArgs("remember_fact", { fact: 42 })).toEqual({ fact: "" });
  });
});
