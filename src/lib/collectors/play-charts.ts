/**
 * Play Store chart position.
 *
 * The counterpart to itunes-charts.ts, and the reason the overview can finally
 * name a store beside a rank. Until now "Education, UZ" meant Apple and said
 * nothing about it, which is fine until somebody asks where the app sits on the
 * store most of its users are actually on.
 *
 * Fetched through google-play-scraper rather than by hand, matching how reviews
 * and keyword suggestions already reach Play. Google renders its charts from a
 * batched RPC rather than from the HTML, so there is no page to parse.
 *
 * Measured 2026-08-24, UZ: Education #5, outside the top 100 overall.
 */

import { CHART_FEED_LIMIT, ANDROID_PACKAGE } from "./config";
import { ParseError, type ChartRank } from "./types";

const SOURCE = "play-charts";

/** The shape of one entry, of the many fields the package returns. */
interface PlayListEntry {
  appId?: string;
}

export interface PlayChartQuery {
  country: string;
  /** Play collection id, e.g. TOP_FREE. */
  collection: string;
  /** Play category name such as EDUCATION, or undefined for the whole store. */
  category?: string;
  /** Stored in chart_ranks.genre. Play category name, or the OVERALL sentinel. */
  genre: string;
  chartType: string;
}

/**
 * Where one app sits in a fetched chart.
 *
 * Split from the fetch so the ranking arithmetic is testable without touching
 * the network, and so one fetched chart can be read for several apps later
 * without paying for the request twice, the way parseChartMany already does for
 * Apple.
 */
export function parsePlayChart(
  entries: unknown,
  query: PlayChartQuery,
  packageName: string = ANDROID_PACKAGE,
): ChartRank {
  if (!Array.isArray(entries)) {
    throw new ParseError(SOURCE, "chart payload was not an array");
  }

  const list = entries as PlayListEntry[];
  const index = list.findIndex((entry) => entry?.appId === packageName);

  return {
    platform: "android",
    storeId: packageName,
    country: query.country,
    chartType: query.chartType,
    genre: query.genre,
    // -1 becomes null: polled fine, app is outside the chart. Same contract as
    // Apple's, because chart_ranks.rank must keep meaning "outside the feed"
    // rather than "the poll failed".
    rank: index === -1 ? null : index + 1,
    feedSize: list.length,
  };
}

export async function fetchPlayChart(query: PlayChartQuery): Promise<unknown> {
  /*
   * Imported lazily and normalised for both module shapes, matching
   * play-reviews.ts. The package is published as CommonJS with an ESM interop
   * default, so a static import resolves differently depending on how the
   * route is bundled.
   */
  const imported = await import("google-play-scraper");
  const gplay = (imported as { default?: unknown }).default ?? imported;
  const api = gplay as {
    list: (options: Record<string, unknown>) => Promise<unknown>;
  };

  return api.list({
    collection: query.collection,
    ...(query.category ? { category: query.category } : {}),
    country: query.country,
    num: CHART_FEED_LIMIT,
  });
}
