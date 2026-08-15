/**
 * Search-suggest parsers. The fixtures are real responses captured on
 * 2026-08-15 for the UZ storefront, so the expectations double as a record of
 * what Apple actually suggested for "ingliz tili" that day.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseAppleHints,
  parseAppleTrending,
  parsePlaySuggest,
} from "./suggest";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseAppleHints", () => {
  it("reads the suggestion terms in Apple's order", () => {
    const terms = parseAppleHints(fixture("apple-hints-uz.xml"));

    expect(terms).toHaveLength(9);
    expect(terms[0]).toBe("ingliz tili lugat");
    expect(terms[1]).toBe("ingliz tilini o’rganish");
  });

  it("decodes XML entities so a term with an ampersand survives", () => {
    const plist =
      "<plist><dict><key>hints</key><array><dict>" +
      "<key>term</key><string>a &amp; b</string>" +
      "</dict></array></dict></plist>";

    expect(parseAppleHints(plist)).toEqual(["a & b"]);
  });

  it("returns nothing for a hint-less response rather than throwing", () => {
    expect(parseAppleHints("<plist><dict></dict></plist>")).toEqual([]);
  });
});

describe("parseAppleTrending", () => {
  it("reads the UZ response, which is currently an empty list", () => {
    // Apple has not populated trending for the UZ storefront. The collector
    // stores nothing on an empty list; this pin records that emptiness is a
    // real observed state, not a parser failure.
    expect(parseAppleTrending(fixture("apple-trends-uz.json"))).toEqual([]);
  });

  it("accepts plain strings and labelled objects, whichever Apple sends", () => {
    // The populated shape is unverified for UZ, so both plausible encodings
    // are accepted and anything else is skipped rather than crashing the run.
    const payload = JSON.stringify({
      trendingSearches: ["matematika", { label: "ingliz tili" }, { term: "dars" }, 42],
    });

    expect(parseAppleTrending(payload)).toEqual(["matematika", "ingliz tili", "dars"]);
  });

  it("treats a malformed body as empty rather than failing the run", () => {
    expect(parseAppleTrending("not json")).toEqual([]);
  });
});

describe("parsePlaySuggest", () => {
  it("keeps strings and drops anything else the library might return", () => {
    expect(parsePlaySuggest(["ingliz tili", 3, null, "dars"])).toEqual([
      "ingliz tili",
      "dars",
    ]);
  });

  it("handles a non-array without throwing", () => {
    expect(parsePlaySuggest(undefined)).toEqual([]);
  });
});
