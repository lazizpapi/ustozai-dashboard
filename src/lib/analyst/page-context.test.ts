import { describe, expect, it } from "vitest";

import { PAGE_CONTEXT, pageName, pageSuggestions } from "./page-context";

/**
 * What the chat knows about where it was opened from.
 *
 * The value is that asking "how are we doing?" on the Market page and on the
 * Reviews page are different questions, and the starter chips should reflect
 * that rather than offering the same four prompts everywhere.
 */

describe("pageName", () => {
  it("names the page a known path belongs to", () => {
    expect(pageName("/market")).toBe("Market (competitors)");
    expect(pageName("/")).toBe("Overview");
  });

  it("returns null for a path it does not know", () => {
    // Null rather than a guess: the caller appends this to a system prompt,
    // and a wrong page name is worse than no page name.
    expect(pageName("/something-else")).toBeNull();
  });

  it("ignores a trailing slash and a query string", () => {
    expect(pageName("/market/")).toBe("Market (competitors)");
    expect(pageName("/growth?period=week")).toBe(pageName("/growth"));
  });
});

describe("pageSuggestions", () => {
  it("offers questions about the page you are actually on", () => {
    const market = pageSuggestions("/market").join(" ").toLowerCase();
    expect(market).toMatch(/competitor|rank|praktika|ahead/);

    const reviews = pageSuggestions("/reviews").join(" ").toLowerCase();
    expect(reviews).toMatch(/complain|review|rating|say/);
  });

  it("falls back to general questions on an unknown page", () => {
    expect(pageSuggestions("/nowhere").length).toBeGreaterThan(0);
  });

  it("never offers an empty list, whatever the path", () => {
    // The chips are the empty state's only affordance; an empty array would
    // leave a blank panel with no hint of what the thing does.
    for (const path of [...Object.keys(PAGE_CONTEXT), "/unknown", "", "/"]) {
      expect(pageSuggestions(path).length).toBeGreaterThan(0);
    }
  });

  it("keeps every suggestion short enough to read on a chip", () => {
    for (const path of Object.keys(PAGE_CONTEXT)) {
      for (const suggestion of pageSuggestions(path)) {
        expect(suggestion.length).toBeLessThanOrEqual(60);
      }
    }
  });

  it("uses no em-dashes in any suggestion", () => {
    // House style, and a chip is exactly where one would look worst.
    for (const path of Object.keys(PAGE_CONTEXT)) {
      expect(pageSuggestions(path).join(" ")).not.toMatch(/[—–]/);
    }
  });
});
