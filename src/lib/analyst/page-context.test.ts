import { describe, expect, it } from "vitest";

import { PAGE_CONTEXT, pageName, pagePrompt, pageSuggestions } from "./page-context";

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

describe("the pages that had no context at all", () => {
  /*
   * The dock rendered on all of these and sent nothing, so the model was told
   * the user was nowhere. Two of them are dynamic routes, which an exact
   * lookup can never match.
   */

  it("names the business page, where the money is", () => {
    expect(pageName("/business")).toContain("Business");
  });

  it("names the audience index", () => {
    expect(pageName("/audience")).toContain("Audience");
  });

  it("names a competitor profile behind its slug", () => {
    expect(pageName("/market/praktika")).toBe("a single competitor profile");
    expect(pageName("/market/ibrat-academy")).toBe("a single competitor profile");
  });

  it("names a single audience platform behind its slug", () => {
    expect(pageName("/audience/telegram")).toBe("one audience platform in detail");
    expect(pageName("/audience/instagram")).toBe("one audience platform in detail");
  });

  it("prefers the exact page over the prefix that also matches it", () => {
    // "/audience" must stay the index, not fall through to the platform entry.
    expect(pageName("/audience")).toContain("three channels");
  });

  it("offers the dynamic routes their own chips rather than the general ones", () => {
    expect(pageSuggestions("/market/englify")).not.toEqual(pageSuggestions("/nowhere"));
    expect(pageSuggestions("/audience/youtube")).not.toEqual(pageSuggestions("/nowhere"));
  });

  it("still admits when a page is genuinely unknown", () => {
    // Null rather than a guess: this line goes into the system prompt.
    expect(pageName("/marketing-costs")).toBeNull();
    expect(pageName("/audiencex")).toBeNull();
  });

  it("holds the house rules on the new chips too", () => {
    for (const path of ["/business", "/audience", "/market/praktika", "/audience/telegram"]) {
      for (const suggestion of pageSuggestions(path)) {
        expect(suggestion.length).toBeLessThanOrEqual(60);
        expect(suggestion).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("pagePrompt", () => {
  it("describes a dashboard page as somewhere the reader is looking", () => {
    expect(pagePrompt("/market")).toContain("looking at the Market (competitors) page");
  });

  it("says nothing at all about a path it does not know", () => {
    expect(pagePrompt("/nowhere")).toBeNull();
  });

  it("lets Telegram replace the sentence entirely", () => {
    /*
     * Telegram is not somewhere you look, it is somewhere you type. The
     * templated sentence would tell the model the reader is looking at a
     * dashboard page they cannot see, and then ask it to write for a screen
     * that is actually a phone in a chat app.
     */
    const prompt = pagePrompt("/telegram")!;

    expect(prompt).not.toContain("looking at");
    expect(prompt).toContain("Telegram");
    expect(prompt).toContain("no tables");
  });
});
