/**
 * App Store chart position.
 *
 * This uses the legacy itunes.apple.com RSS rather than the current
 * rss.marketingtools.apple.com host, for one reason: the new host does not
 * support genre filtering. Passing ?genre=6017 to it is silently ignored and
 * you get the overall chart back. Since the number people actually care about
 * is "where are we in Education", the legacy feed is the only source.
 *
 * That feed is undocumented and could disappear. Every poll writes a
 * collector_runs row so the UI can show the data going stale instead of
 * quietly flatlining.
 *
 * Measured 2026-08-11, UZ Education: iPhone #21, iPad #22, not in top grossing,
 * and outside the top 100 overall.
 */

import { fetchJson } from "./http";
import { CHART_FEED_LIMIT, IOS_APP_ID, OVERALL_GENRE } from "./config";
import { ParseError, type ChartApp, type ChartRank } from "./types";

const SOURCE = "itunes-charts";

interface FeedEntry {
  id?: { attributes?: { "im:id"?: string } };
  "im:name"?: { label?: string };
}

interface ChartResponse {
  feed?: { entry?: FeedEntry[] };
}

export interface ChartQuery {
  country: string;
  /** e.g. topfreeapplications, topfreeipadapplications, topgrossingapplications */
  feed: string;
  /** Apple genre id, or the OVERALL_GENRE sentinel. */
  genre: string;
  chartType: string;
  appId?: string;
}

export function parseChart(
  payload: unknown,
  query: ChartQuery,
): ChartRank {
  const body = payload as ChartResponse;
  if (!body?.feed) throw new ParseError(SOURCE, "payload has no feed");

  // An absent entry array means an empty chart, not a malformed one.
  const entries = Array.isArray(body.feed.entry) ? body.feed.entry : [];
  const appId = query.appId ?? IOS_APP_ID;

  const index = entries.findIndex(
    (entry) => entry?.id?.attributes?.["im:id"] === appId,
  );

  return {
    platform: "ios",
    storeId: appId,
    country: query.country,
    chartType: query.chartType,
    genre: query.genre,
    // -1 becomes null: polled fine, app is outside the feed.
    rank: index === -1 ? null : index + 1,
    feedSize: entries.length,
  };
}

/**
 * Every tracked app's position in one feed.
 *
 * Pure, and the reason competitor tracking costs no extra requests. A chart
 * payload is the same hundred entries whoever is asking, so the feed is fetched
 * once and read once per app rather than once per app.
 */
export function parseChartMany(
  payload: unknown,
  query: ChartQuery,
  appIds: readonly string[],
): ChartRank[] {
  return appIds.map((appId) => parseChart(payload, { ...query, appId }));
}

/**
 * The visible top of the chart, ranked from one.
 *
 * Same payload as parseChart, read for a different question: not "where are
 * we" but "who is around us and who is moving". Twenty is enough to hold every
 * app the team would recognise without turning the page into a phone book.
 *
 * A malformed entry is dropped but its rank is not reassigned: rank describes
 * the chart, and renumbering the apps below a parse gap would report positions
 * nobody actually holds.
 */
export function parseChartTop(
  payload: unknown,
  query: ChartQuery,
  n = 20,
): ChartApp[] {
  const body = payload as ChartResponse;
  if (!body?.feed) throw new ParseError(SOURCE, "payload has no feed");

  const entries = Array.isArray(body.feed.entry) ? body.feed.entry : [];

  return entries.slice(0, n).flatMap((entry, index) => {
    const storeId = entry?.id?.attributes?.["im:id"];
    const name = entry?.["im:name"]?.label;
    if (!storeId || !name) return [];

    return [
      {
        country: query.country,
        chartType: query.chartType,
        genre: query.genre,
        rank: index + 1,
        storeId,
        name,
      },
    ];
  });
}

export async function fetchChartPayload(query: ChartQuery): Promise<unknown> {
  const genrePath =
    query.genre === OVERALL_GENRE ? "" : `genre=${encodeURIComponent(query.genre)}/`;
  const url =
    `https://itunes.apple.com/${encodeURIComponent(query.country)}/rss/${query.feed}` +
    `/limit=${CHART_FEED_LIMIT}/${genrePath}json`;

  return fetchJson(url);
}

export async function fetchChart(query: ChartQuery): Promise<ChartRank> {
  return parseChart(await fetchChartPayload(query), query);
}

export async function fetchChartMany(
  query: ChartQuery,
  appIds: readonly string[],
): Promise<ChartRank[]> {
  return parseChartMany(await fetchChartPayload(query), query, appIds);
}
