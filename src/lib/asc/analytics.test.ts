import { describe, expect, it } from "vitest";

import {
  newestInstance,
  normaliseDownloadType,
  normaliseSourceType,
  parseAnalyticsTsv,
} from "./analytics";

/**
 * The two things that produce wrong numbers here, rather than obvious errors,
 * are restated dates being summed and segments being read by column position.
 * Both are pinned below.
 */

const header = [
  "Date",
  "App Name",
  "App Apple Identifier",
  "Download Type",
  "App Version",
  "Device",
  "Platform Version",
  "Source Type",
  "Source Info",
  "Campaign",
  "Page Type",
  "Page Title",
  "Pre-Order",
  "Territory",
  "Counts",
].join("\t");

const row = (o: {
  date?: string;
  type?: string;
  source?: string;
  device?: string;
  territory?: string;
  counts: number;
  version?: string;
}) =>
  [
    o.date ?? "2026-08-11",
    "Ustoz AI",
    "6504815934",
    o.type ?? "First-time Download",
    o.version ?? "2.2.6",
    o.device ?? "iPhone",
    "18.5",
    o.source ?? "App Store search",
    "",
    "",
    "Product page",
    "",
    "false",
    o.territory ?? "UZ",
    String(o.counts),
  ].join("\t");

describe("parseAnalyticsTsv", () => {
  it("reads a detailed row into the shape the table stores", () => {
    const rows = parseAnalyticsTsv([header, row({ counts: 71 })].join("\n"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: "2026-08-11",
      country: "uz",
      downloadType: "first_time",
      sourceType: "app_store_search",
      device: "iphone",
      units: 71,
    });
  });

  it("collapses rows that differ only by dimensions we do not store", () => {
    // The detailed report splits by app version, page title and campaign as
    // well. Those columns are not in our table, so several source rows have to
    // fold into one without losing any counts.
    const rows = parseAnalyticsTsv(
      [header, row({ counts: 40, version: "2.2.6" }), row({ counts: 31, version: "2.2.5" })].join("\n"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(71);
  });

  it("keeps genuinely different dimensions apart", () => {
    const rows = parseAnalyticsTsv(
      [
        header,
        row({ counts: 71, source: "App Store search" }),
        row({ counts: 22, source: "App Store browse" }),
        row({ counts: 9, territory: "US" }),
      ].join("\n"),
    );

    expect(rows).toHaveLength(3);
    expect(rows.reduce((sum, r) => sum + r.units, 0)).toBe(102);
  });

  it("reads columns by name even when Apple reorders them", () => {
    // Apple states outright that column position can change between
    // deliveries, so position-based parsing would silently start reading the
    // wrong field one day.
    const shuffled = ["Counts", "Territory", "Date", "Source Type", "Download Type"].join("\t");
    const rows = parseAnalyticsTsv(
      [shuffled, ["55", "UZ", "2026-08-11", "App Store browse", "Redownload"].join("\t")].join("\n"),
    );

    expect(rows[0]).toMatchObject({
      units: 55,
      country: "uz",
      downloadType: "redownload",
      sourceType: "app_store_browse",
    });
  });

  it("marks worldwide rows rather than inventing a country", () => {
    // The Standard variant has no Territory column at all.
    const noTerritory = ["Date", "Download Type", "Counts"].join("\t");
    const rows = parseAnalyticsTsv(
      [noTerritory, ["2026-08-11", "First-time Download", "108"].join("\t")].join("\n"),
    );

    expect(rows[0].country).toBe("all");
  });

  it("throws when the columns it depends on are absent", () => {
    expect(() => parseAnalyticsTsv("Foo\tBar\n1\t2")).toThrow(/missing Date or Counts/);
  });

  it("returns nothing for a header-only segment rather than throwing", () => {
    expect(parseAnalyticsTsv(header)).toEqual([]);
    expect(parseAnalyticsTsv("")).toEqual([]);
  });
});

describe("newestInstance", () => {
  const instance = (id: string, processingDate: string, granularity = "DAILY") => ({
    id,
    attributes: { granularity, processingDate },
  });

  it("takes the newest restatement instead of summing them", () => {
    // Apple republishes a date as late events arrive. Merging two instances
    // for the same date double counts it, which their docs warn about
    // explicitly and which would look like a genuine spike in downloads.
    const picked = newestInstance([
      instance("older", "2026-08-11"),
      instance("newer", "2026-08-12"),
      instance("oldest", "2026-08-10"),
    ]);

    expect(picked?.id).toBe("newer");
  });

  it("prefers daily granularity over weekly or monthly", () => {
    const picked = newestInstance([
      instance("weekly", "2026-08-13", "WEEKLY"),
      instance("daily", "2026-08-12", "DAILY"),
    ]);

    expect(picked?.id).toBe("daily");
  });

  it("returns null when Apple has produced nothing yet", () => {
    // The normal state for a day or two after the ongoing request is created.
    expect(newestInstance([])).toBeNull();
  });
});

describe("label normalisation", () => {
  it("maps Apple's download wording onto the stored values", () => {
    expect(normaliseDownloadType("First-time Download")).toBe("first_time");
    expect(normaliseDownloadType("Redownload")).toBe("redownload");
    expect(normaliseDownloadType("Manual update")).toBe("update");
    expect(normaliseDownloadType("Auto-update")).toBe("update");
    expect(normaliseDownloadType("Restore")).toBe("restore");
  });

  it("maps the traffic sources", () => {
    expect(normaliseSourceType("App Store search")).toBe("app_store_search");
    expect(normaliseSourceType("App Store browse")).toBe("app_store_browse");
    expect(normaliseSourceType("Web referrer")).toBe("web_referrer");
    expect(normaliseSourceType("App referrer")).toBe("app_referrer");
    expect(normaliseSourceType("Unavailable")).toBe("unavailable");
    expect(normaliseSourceType("")).toBe("unavailable");
  });
});
