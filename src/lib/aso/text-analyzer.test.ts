import { describe, expect, it } from "vitest";

import { analyzeText } from "./text-analyzer";

/**
 * The text analyzer: keyword frequency and density for any pasted listing
 * text. The delicate part is tokenizing Uzbek Latin, where the apostrophe in
 * oʻrganish or ta'lim is part of the word and appears as three different
 * codepoints depending on who typed it.
 */

describe("analyzeText", () => {
  it("counts words and computes density against the total", () => {
    const result = analyzeText("dars dars dars matematika", []);

    expect(result.wordCount).toBe(4);
    const dars = result.words.find((w) => w.term === "dars");
    expect(dars).toMatchObject({ count: 3, density: 0.75 });
  });

  it("keeps Uzbek apostrophe words whole, whatever the codepoint", () => {
    // U+2019, U+02BC and ASCII ' must tokenize as one word each and count as
    // the same word, because they are the same word.
    const result = analyzeText("o’rganish oʻrganish o'rganish", []);

    expect(result.wordCount).toBe(3);
    expect(result.words[0].count).toBe(3);
  });

  it("strips HTML tags, which Play descriptions are full of", () => {
    const result = analyzeText("kurslar<br><br>kurslar <b>test</b>", []);

    expect(result.wordCount).toBe(3);
    expect(result.words.find((w) => w.term === "kurslar")?.count).toBe(2);
    expect(result.words.find((w) => w.term === "br")).toBeUndefined();
  });

  it("counts bigram phrases", () => {
    const result = analyzeText("ingliz tili kurs ingliz tili", []);

    expect(result.phrases.find((p) => p.term === "ingliz tili")?.count).toBe(2);
  });

  it("reports tracked keywords including the ones that never appear", () => {
    // A zero is the finding: the listing does not use a term we rank for.
    const result = analyzeText("matematika darslari", ["matematika", "ustoz"]);

    expect(result.tracked).toEqual([
      { keyword: "matematika", count: 1 },
      { keyword: "ustoz", count: 0 },
    ]);
  });

  it("matches multi-word tracked keywords as phrases", () => {
    const result = analyzeText("ingliz tili grammatikasi", ["ingliz tili"]);
    expect(result.tracked[0].count).toBe(1);
  });

  it("collapses apostrophe variants of a tracked keyword into one row", () => {
    // The rank table tracks ta'lim in both spellings because Apple indexes
    // them separately; for text they are one word, and two identical rows
    // would just look broken.
    const result = analyzeText("ta'lim", ["ta'lim", "taʼlim"]);

    expect(result.tracked).toHaveLength(1);
    expect(result.tracked[0].count).toBe(1);
  });

  it("is case-insensitive across Latin and Cyrillic", () => {
    const result = analyzeText("Ustoz USTOZ Устоз устоз", ["ustoz"]);

    expect(result.tracked[0].count).toBe(2);
    expect(result.words.find((w) => w.term === "устоз")?.count).toBe(2);
  });

  it("handles empty input", () => {
    expect(analyzeText("", ["ustoz"])).toMatchObject({
      wordCount: 0,
      words: [],
      phrases: [],
    });
  });
});
