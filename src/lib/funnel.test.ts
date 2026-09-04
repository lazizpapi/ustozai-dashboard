import { describe, expect, it } from "vitest";

import { funnelBySource, sourceLabel } from "./funnel";

/**
 * Where App Store downloads come from.
 *
 * Apple breaks every discovery event and every download down by source, and
 * the collectors have stored that breakdown since the first analytics report
 * arrived. Nothing has ever read it, so the page shows one funnel that mixes
 * a search result with a link from another app.
 */

const impression = (source: string, units: number) => ({
  event: "impression",
  source_type: source,
  units,
});

const tap = (source: string, units: number) => ({
  event: "tap",
  source_type: source,
  units,
});

const pageView = (source: string, units: number) => ({
  event: "page_view",
  source_type: source,
  units,
});

describe("funnelBySource", () => {
  it("adds up each stage per source", () => {
    const sources = funnelBySource(
      [
        impression("app_store_search", 900),
        impression("app_store_search", 100),
        tap("app_store_search", 300),
        pageView("app_store_search", 280),
      ],
      [{ source_type: "app_store_search", units: 94 }],
    );

    expect(sources).toEqual([
      {
        source: "app_store_search",
        impressions: 1000,
        taps: 300,
        pageViews: 280,
        firstTimeDownloads: 94,
      },
    ]);
  });

  it("keeps sources apart", () => {
    const sources = funnelBySource(
      [impression("app_store_search", 900), impression("web_referrer", 20)],
      [
        { source_type: "app_store_search", units: 94 },
        { source_type: "web_referrer", units: 3 },
      ],
    );

    expect(sources.map((row) => [row.source, row.impressions, row.firstTimeDownloads])).toEqual([
      ["app_store_search", 900, 94],
      ["web_referrer", 20, 3],
    ]);
  });

  it("orders by the downloads each source produced", () => {
    // The question is which source brings people in, so the answer leads.
    const sources = funnelBySource(
      [impression("app_store_browse", 5000), impression("app_store_search", 100)],
      [
        { source_type: "app_store_browse", units: 2 },
        { source_type: "app_store_search", units: 94 },
      ],
    );

    expect(sources.map((row) => row.source)).toEqual([
      "app_store_search",
      "app_store_browse",
    ]);
  });

  it("shows a source that produced downloads but no stored impressions", () => {
    // The two reports are separate deliveries and do not always agree on
    // which sources they mention. Dropping the row would lose real downloads.
    const sources = funnelBySource([], [{ source_type: "app_referrer", units: 6 }]);

    expect(sources).toEqual([
      {
        source: "app_referrer",
        impressions: 0,
        taps: 0,
        pageViews: 0,
        firstTimeDownloads: 6,
      },
    ]);
  });

  it("files an unstated source under Apple's own name for it", () => {
    const sources = funnelBySource(
      [impression("", 40), { event: "impression", source_type: null, units: 10 }],
      [],
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].source).toBe("unavailable");
    expect(sources[0].impressions).toBe(50);
  });

  it("keeps a source it has no label for as its own row", () => {
    // Apple publishes categories this dashboard has never seen, app clips and
    // institutional purchases among them. Folding those into "unavailable"
    // would report a real channel as a measurement gap.
    const sources = funnelBySource([impression("institutional", 12)], []);

    expect(sources.map((row) => row.source)).toEqual(["institutional"]);
  });

  it("ignores an event it cannot place in the funnel", () => {
    const sources = funnelBySource(
      [{ event: "something_new", source_type: "app_store_search", units: 99 }],
      [{ source_type: "app_store_search", units: 1 }],
    );

    expect(sources[0]).toEqual({
      source: "app_store_search",
      impressions: 0,
      taps: 0,
      pageViews: 0,
      firstTimeDownloads: 1,
    });
  });

  it("keeps a source that got attention and produced nothing", () => {
    // Browse currently spends thousands of impressions for single-figure
    // installs. That row is the most useful one in the table.
    const sources = funnelBySource([impression("app_store_browse", 8281)], []);

    expect(sources).toHaveLength(1);
    expect(sources[0].impressions).toBe(8281);
  });

  it("drops a source that is zero at every stage", () => {
    // Apple sends rows for surfaces that did nothing at all. A line of
    // zeroes is not a finding, and it teaches people to skip the table.
    const sources = funnelBySource(
      [impression("unavailable", 0), impression("app_store_search", 900)],
      [{ source_type: "unavailable", units: 0 }],
    );

    expect(sources.map((row) => row.source)).toEqual(["app_store_search"]);
  });

  it("has nothing to say about nothing", () => {
    expect(funnelBySource([], [])).toEqual([]);
  });
});

describe("sourceLabel", () => {
  it("names the sources we know", () => {
    expect(sourceLabel("app_store_search")).toBe("App Store search");
    expect(sourceLabel("web_referrer")).toBe("Web links");
    expect(sourceLabel("unavailable")).toBe("Not attributed");
  });

  it("makes a readable label out of one it has never seen", () => {
    expect(sourceLabel("app_clip")).toBe("App clip");
  });
});
