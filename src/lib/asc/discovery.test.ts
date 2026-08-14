import { describe, expect, it } from "vitest";

import {
  IMPRESSION_EVENTS,
  PAGE_VIEW_EVENTS,
  TAP_EVENTS,
  normaliseEvent,
  parseDiscoveryTsv,
} from "./discovery";

/**
 * The column names here are Apple's documented ones, not observed ones: this
 * parser was written before the ongoing analytics request had produced a
 * single instance of the report.
 *
 * That is why the missing-column test below is the most important one in the
 * file. It is the mechanism that turns a wrong guess about Apple's headers
 * into a named, one-line fix instead of a dashboard confidently showing a
 * number that is not impressions.
 */

const HEADER = [
  "Date",
  "App Name",
  "App Apple Identifier",
  "Event",
  "Page Type",
  "Source Type",
  "Territory",
  "Device",
  "Counts",
  "Unique Counts",
];

function row(values: Partial<Record<string, string>>): string {
  return HEADER.map((column) => values[column] ?? "").join("\t");
}

function tsv(...rows: string[]): string {
  return [HEADER.join("\t"), ...rows].join("\n");
}

describe("parseDiscoveryTsv", () => {
  it("reads impressions and page views by column name", () => {
    const parsed = parseDiscoveryTsv(
      tsv(
        row({ Date: "2026-08-12", Event: "Impression", Territory: "UZ", Counts: "5000" }),
        row({
          Date: "2026-08-12",
          Event: "Product Page View",
          Territory: "UZ",
          Counts: "800",
        }),
      ),
    );

    expect(parsed).toHaveLength(2);
    expect(parsed.find((r) => r.event === "impression")?.units).toBe(5000);
    expect(parsed.find((r) => r.event === "product_page_view")?.units).toBe(800);
  });

  it("reads by name, so a reordered header still parses", () => {
    // Apple states outright that column order can change between deliveries.
    const reordered = ["Counts", "Event", "Date"].join("\t");
    const parsed = parseDiscoveryTsv(`${reordered}\n1200\tImpression\t2026-08-12`);

    expect(parsed[0]).toMatchObject({ event: "impression", units: 1200 });
  });

  it("throws and echoes the header when Event is missing", () => {
    // The whole point. Without Event there is no funnel, only an
    // undifferentiated pile of counts that would render as impressions.
    const noEvent = "Date\tTerritory\tCounts\n2026-08-12\tUZ\t10";

    expect(() => parseDiscoveryTsv(noEvent)).toThrow(/missing Date, Event or Counts/);
    expect(() => parseDiscoveryTsv(noEvent)).toThrow(/got: Date, Territory, Counts/);
  });

  it("throws when Counts is missing", () => {
    expect(() => parseDiscoveryTsv("Date\tEvent\n2026-08-12\tImpression")).toThrow(
      /missing Date, Event or Counts/,
    );
  });

  it("ignores Unique Counts entirely", () => {
    // Unique device counts are not additive, and these rows are collapsed by
    // summing, so a summed unique count would be confidently wrong.
    const parsed = parseDiscoveryTsv(
      tsv(row({ Date: "2026-08-12", Event: "Impression", Counts: "100", "Unique Counts": "70" })),
    );

    expect(parsed[0].units).toBe(100);
    expect(JSON.stringify(parsed)).not.toContain("70");
  });

  it("sums rows that collapse into the same dimension key", () => {
    // The detailed report splits further than this table stores (app version,
    // campaign, page title), so several of Apple's rows become one of ours.
    const parsed = parseDiscoveryTsv(
      tsv(
        row({ Date: "2026-08-12", Event: "Impression", Territory: "UZ", Counts: "300" }),
        row({ Date: "2026-08-12", Event: "Impression", Territory: "UZ", Counts: "200" }),
      ),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].units).toBe(500);
  });

  it("keeps different territories apart", () => {
    const parsed = parseDiscoveryTsv(
      tsv(
        row({ Date: "2026-08-12", Event: "Impression", Territory: "UZ", Counts: "300" }),
        row({ Date: "2026-08-12", Event: "Impression", Territory: "RU", Counts: "200" }),
      ),
    );

    expect(parsed).toHaveLength(2);
  });

  it("marks a missing Territory as all rather than inventing a country", () => {
    const parsed = parseDiscoveryTsv("Date\tEvent\tCounts\n2026-08-12\tImpression\t10");
    expect(parsed[0].country).toBe("all");
  });

  it("skips rows with an unparseable date or count", () => {
    const parsed = parseDiscoveryTsv(
      tsv(
        row({ Date: "not a date", Event: "Impression", Counts: "10" }),
        row({ Date: "2026-08-12", Event: "Impression", Counts: "n/a" }),
        row({ Date: "2026-08-12", Event: "Impression", Counts: "42" }),
      ),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].units).toBe(42);
  });

  it("returns nothing for a header-only segment", () => {
    expect(parseDiscoveryTsv(HEADER.join("\t"))).toEqual([]);
    expect(parseDiscoveryTsv("")).toEqual([]);
  });
});

describe("the funnel event names", () => {
  it("matches what Apple actually sends", () => {
    // Confirmed against the first real instance on 2026-08-14. The list
    // originally guessed "product_page_view" and Apple sends "page_view", so
    // the funnel showed impressions against zero page views: a wrong number
    // rather than an error, which is exactly what these constants exist to
    // prevent. Pinned so the guess cannot come back.
    expect(IMPRESSION_EVENTS).toContain("impression");
    expect(TAP_EVENTS).toContain("tap");
    expect(PAGE_VIEW_EVENTS).toContain("page_view");
  });

  it("normalises Apple's labels onto those names", () => {
    expect(normaliseEvent("Impression")).toBe("impression");
    expect(normaliseEvent("Tap")).toBe("tap");
    expect(normaliseEvent("Page view")).toBe("page_view");
  });

  it("keeps the three stages disjoint, so nothing is counted twice", () => {
    const all = [...IMPRESSION_EVENTS, ...TAP_EVENTS, ...PAGE_VIEW_EVENTS];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("normaliseEvent", () => {
  it("lowercases and underscores Apple's labels", () => {
    expect(normaliseEvent("Product Page View")).toBe("product_page_view");
  });

  it("passes an unrecognised event through rather than dropping it", () => {
    // Not whitelisted on purpose: the vocabulary was unverified, and an event
    // we did not anticipate should be visible in the table, not discarded.
    expect(normaliseEvent("Some New Apple Event")).toBe("some_new_apple_event");
  });

  it("never returns an empty string, which would break the not-null column", () => {
    expect(normaliseEvent("   ")).toBe("unknown");
  });
});
