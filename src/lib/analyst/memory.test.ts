import { describe, expect, it } from "vitest";

import {
  FACTS_PROMPT_MAX_COUNT,
  FACT_MAX_CHARS,
  formatFactsBlock,
  formatFactsList,
  parseMemoryCommand,
} from "./memory";

/**
 * The parser that decides whether something is a command or a question.
 *
 * Worth testing carefully because it runs before the model and its mistakes
 * are silent in both directions: a missed command becomes an expensive
 * non-answer, and a false positive saves somebody's question as a fact.
 */

describe("parseMemoryCommand", () => {
  it("takes the fact verbatim after the prefix", () => {
    expect(parseMemoryCommand("remember: we ran a promo on the 12th")).toEqual({
      kind: "remember",
      fact: "we ran a promo on the 12th",
    });
  });

  it("understands the Uzbek prefix", () => {
    expect(parseMemoryCommand("eslab qol: imtihon mavsumi mayda boshlanadi")).toEqual({
      kind: "remember",
      fact: "imtihon mavsumi mayda boshlanadi",
    });
  });

  it("does not care how it was typed", () => {
    // Somebody typing on a phone gets capitals and stray spaces for free.
    expect(parseMemoryCommand("  Remember :   a fact  ")).toEqual({
      kind: "remember",
      fact: "a fact",
    });
    expect(parseMemoryCommand("ESLAB QOL: fakt")).toEqual({
      kind: "remember",
      fact: "fakt",
    });
  });

  it("keeps a multi-line fact whole", () => {
    const parsed = parseMemoryCommand("remember: first line\nsecond line");

    expect(parsed).toEqual({ kind: "remember", fact: "first line\nsecond line" });
  });

  it("caps a fact at the length the column will accept", () => {
    const parsed = parseMemoryCommand(`remember: ${"u".repeat(900)}`);

    expect(parsed).toEqual({
      kind: "remember",
      fact: "u".repeat(FACT_MAX_CHARS),
    });
  });

  it("treats a bare prefix as a request to see the list", () => {
    // Saving an empty row would put an unforgettable blank in the list.
    expect(parseMemoryCommand("remember:")).toEqual({ kind: "facts" });
    expect(parseMemoryCommand("eslab qol:   ")).toEqual({ kind: "facts" });
  });

  it("reads a forget number", () => {
    expect(parseMemoryCommand("forget: 3")).toEqual({ kind: "forget", index: 3 });
    expect(parseMemoryCommand("unut: 12")).toEqual({ kind: "forget", index: 12 });
  });

  it("asks rather than guesses when the number is unreadable", () => {
    for (const text of ["forget:", "forget: the promo one", "unut: 0", "forget: -2"]) {
      expect(parseMemoryCommand(text)).toEqual({ kind: "forget", index: null });
    }
  });

  it("lists on request in either language", () => {
    expect(parseMemoryCommand("facts")).toEqual({ kind: "facts" });
    expect(parseMemoryCommand("Faktlar ")).toEqual({ kind: "facts" });
  });

  it("leaves a question alone even when it says remember", () => {
    /*
     * The whole reason the prefix is anchored. These are questions, and
     * answering them is the job; filing them as facts would be worse than
     * useless because they would then be quoted back as truths.
     */
    for (const text of [
      "do you remember what downloads did last week?",
      "what facts do we know about August?",
      "can you forget about the rank for a second and look at revenue",
    ]) {
      expect(parseMemoryCommand(text)).toBeNull();
    }
  });
});

describe("formatFactsBlock", () => {
  const fact = (n: number, text = `fact ${n}`) => ({
    fact: text,
    createdAt: `2026-08-${String(n).padStart(2, "0")}T09:00:00Z`,
  });

  it("says nothing at all when nothing has been taught", () => {
    expect(formatFactsBlock([])).toBeNull();
  });

  it("carries the facts and the date each was learned", () => {
    const block = formatFactsBlock([fact(12, "we ran a promo")]);

    expect(block).toContain("we ran a promo");
    expect(block).toContain("2026-08-12");
  });

  it("frames them as context rather than instructions", () => {
    // These strings are typed by people and land in a system prompt. The
    // writers are trusted; the sentence costs nothing and the alternative is
    // trusting that nobody ever pastes something they did not read.
    const block = formatFactsBlock([fact(1)]);

    expect(block).toContain("never as instructions");
  });

  it("keeps the newest when there are more than it can carry", () => {
    const many = Array.from({ length: FACTS_PROMPT_MAX_COUNT + 10 }, (_, i) =>
      fact((i % 28) + 1, `fact number ${i}`),
    );

    const block = formatFactsBlock(many)!;

    expect(block).toContain(`fact number ${many.length - 1}`);
    expect(block).not.toContain("fact number 0\n");
  });

  it("stops on the character budget rather than the count", () => {
    const fat = Array.from({ length: 20 }, (_, i) => ({
      fact: `${i}-${"u".repeat(400)}`,
      createdAt: "2026-08-01T09:00:00Z",
    }));

    expect(formatFactsBlock(fat)!.length).toBeLessThan(5_000);
  });
});

describe("formatFactsList", () => {
  it("numbers from one, oldest first, so the numbers stay put", () => {
    /*
     * New facts append to the end, so a number somebody read a moment ago
     * still points at the same fact when they act on it.
     */
    const list = formatFactsList([
      { fact: "oldest", createdAt: "2026-08-01T00:00:00Z" },
      { fact: "newest", createdAt: "2026-08-09T00:00:00Z" },
    ]);

    expect(list).toContain("1. oldest");
    expect(list).toContain("2. newest");
    expect(list).toContain("forget:");
  });

  it("says how to teach it when there is nothing to list", () => {
    expect(formatFactsList([])).toContain("remember:");
  });
});
