/**
 * Instagram insights: everything the account publishes beyond its follower count.
 *
 * Same contract as the other collectors: fetch, validate hard, return typed
 * records, never touch the database. Parsing is split from fetching so every
 * parser is tested against a saved real payload with no network.
 *
 * Unlike the scrape in social.ts, all of this goes through the official
 * Instagram API with Instagram Login, authenticating as the account rather
 * than pretending to be a browser. It therefore works from Vercel.
 *
 * Three properties of this API drive the shape of the code, all three verified
 * against the live account rather than read from the documentation:
 *
 * 1. Only reach and follower_count can be read as a daily series. Every other
 *    metric accepts period=day and answers with an empty values array and no
 *    error at all. A collector that trusted that would record nothing, daily,
 *    forever, and report success. parseTimeseries throws on it instead.
 *
 * 2. Everything else is an aggregate over a window, so one day costs one
 *    request. That is cheap going forward and expensive backwards, which is
 *    why the backfill treats the two families differently.
 *
 * 3. Nested field expansion filters per item rather than failing the call:
 *    asking for a reels-only metric alongside a feed-only one returns each
 *    post whatever applies to it. So the media request asks for the union of
 *    both metric sets and one page of a hundred posts costs one request.
 */

import { fetchJson } from "./http";
import { ParseError } from "./types";

const API = "https://graph.instagram.com/v23.0";

const SOURCE = "instagram";

/** Meta refuses a since older than this. */
export const MAX_LOOKBACK_DAYS = 730;

/** Beyond this age a post's counters have plateaued and stop being sampled. */
export const POST_METRICS_WINDOW_DAYS = 30;

/**
 * The union of the feed and reels metric sets.
 *
 * Requested together on purpose. The API returns each post only the metrics
 * that exist for its media_product_type, so this costs nothing and avoids
 * having to split the page by format and pay for two requests.
 */
const MEDIA_METRICS = [
  "reach",
  "views",
  "likes",
  "comments",
  "shares",
  "saved",
  "total_interactions",
  "profile_visits",
  "follows",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
] as const;

/** Account metrics that only exist as a window total, never as a series. */
const ACCOUNT_TOTAL_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "profile_views",
  "website_clicks",
] as const;

const STORY_METRICS = [
  "reach",
  "views",
  "replies",
  "shares",
  "total_interactions",
  "navigation",
] as const;

export type Breakdown = "country" | "city" | "age" | "gender";

export const BREAKDOWNS: Breakdown[] = ["country", "city", "age", "gender"];

/** The API spells these two differently; ours follows the demographic cut. */
const BREAKDOWN_PARAM: Record<Breakdown, string> = {
  country: "country",
  city: "city",
  age: "age",
  gender: "gender",
};

export interface InstagramSeriesPoint {
  /** YYYY-MM-DD. */
  date: string;
  value: number;
}

export interface InstagramTotals {
  /** YYYY-MM-DD, the day these totals describe. */
  date: string;
  values: Record<string, number>;
}

export interface InstagramPost {
  mediaId: string;
  postedAt: string;
  mediaProductType: string;
  mediaType: string;
  permalink: string | null;
  caption: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  totalInteractions: number | null;
  profileVisits: number | null;
  follows: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
}

export interface InstagramDemographic {
  breakdown: Breakdown;
  bucket: string;
  followers: number;
}

export interface InstagramStory {
  mediaId: string;
  postedAt: string;
  mediaType: string;
  permalink: string | null;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  totalInteractions: number | null;
  navigation: number | null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The credential travels in a header, never in the query string.
 *
 * Not a style preference. HttpError's message is `${url} returned ${status}`,
 * run-step writes that message into collector_runs, and collector_runs grants
 * authenticated read to every signed-in user. A token in the URL therefore
 * means one 5xx from Meta publishes a live sixty-day credential to everyone
 * holding any department password. Keeping it in a header removes the whole
 * class of accident rather than trying to remember to redact.
 */
const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

function endpoint(path: string, params: Record<string, string>): string {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * Strip the credential Meta embeds in its own paging links.
 *
 * paging.next comes back with access_token already in the query string. Using
 * it as given would undo the header-auth rule above on every page after the
 * first, which is the majority of the requests this module makes.
 */
export function stripToken(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("access_token");
  return parsed.toString();
}

const toUnix = (date: Date): string => String(Math.floor(date.getTime() / 1000));

/** UTC midnight of the day this instant falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * A count we are willing to store, or null.
 *
 * Anything that is not a non-negative integer becomes null rather than a
 * guess. The database rejects negatives outright, and a silently coerced NaN
 * would be worse than an admitted gap.
 */
function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

interface InsightEntry {
  name?: string;
  values?: { value?: unknown; end_time?: string }[];
  total_value?: { value?: unknown; breakdowns?: unknown[] };
}

interface InsightsPayload {
  data?: InsightEntry[];
}

// ---------------------------------------------------------------------------
// Daily series: reach and new followers
// ---------------------------------------------------------------------------

/**
 * The one metric family the API will serve as a day-by-day series.
 *
 * Throws rather than returning an empty array when the series comes back with
 * no points. For reach and follower_count an empty answer means something is
 * wrong; for every other metric it is what the API always does, and a metric
 * name reaching this function by mistake must be loud rather than silent.
 *
 * The date comes from each point's own end_time rather than from our requested
 * window, because Meta buckets by the account's own timezone and snaps the
 * window to it. Trusting our own arithmetic here would shift every reading by
 * a day whenever the account timezone and UTC disagree.
 */
export function parseTimeseries(payload: unknown, metric: string): InstagramSeriesPoint[] {
  const entry = (payload as InsightsPayload)?.data?.find((item) => item.name === metric);
  if (!entry) throw new ParseError(SOURCE, `no ${metric} series in response`);

  const values = entry.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new ParseError(
      SOURCE,
      `${metric} returned no daily points. Only reach and follower_count are ` +
        `served as a series; every other metric answers empty without erroring.`,
    );
  }

  const points: InstagramSeriesPoint[] = [];
  for (const point of values) {
    const value = count(point?.value);
    if (value === null || typeof point?.end_time !== "string") continue;
    points.push({ date: point.end_time.slice(0, 10), value });
  }

  if (points.length === 0) {
    throw new ParseError(SOURCE, `${metric} series held no usable points`);
  }
  return points;
}

export async function fetchInstagramSeries(
  token: string,
  metric: "reach" | "follower_count",
  since: Date,
  until: Date,
): Promise<InstagramSeriesPoint[]> {
  const payload = await fetchJson(
    endpoint("/me/insights", {
      metric,
      period: "day",
      since: toUnix(since),
      until: toUnix(until),
    }),
    {},
    authHeaders(token),
  );
  if (payload === null) throw new ParseError(SOURCE, `empty ${metric} series response`);
  return parseTimeseries(payload, metric);
}

// ---------------------------------------------------------------------------
// Window totals: everything else about the account
// ---------------------------------------------------------------------------

/**
 * Metrics come back carrying a title and description in the account's own
 * locale, which for this account is Russian. Only name and value are read;
 * storing the API's labels would put Russian column headings on an English
 * dashboard the first time somebody rendered them.
 */
export function parseTotalValue(payload: unknown): Record<string, number> {
  const entries = (payload as InsightsPayload)?.data;
  if (!Array.isArray(entries)) throw new ParseError(SOURCE, "no metric list in response");

  const values: Record<string, number> = {};
  for (const entry of entries) {
    if (typeof entry?.name !== "string") continue;
    const value = count(entry.total_value?.value);
    if (value !== null) values[entry.name] = value;
  }
  return values;
}

/**
 * One day's account totals.
 *
 * The window is a full UTC day. Meta snaps it to the account's own day
 * boundary, which is why the caller labels the result with the requested date
 * rather than reading one back: a total_value response carries no end_time to
 * read it from.
 */
export async function fetchInstagramTotals(token: string, day: Date): Promise<InstagramTotals> {
  const start = startOfUtcDay(day);
  const end = new Date(start.getTime() + 86_400_000);

  const payload = await fetchJson(
    endpoint("/me/insights", {
      metric: ACCOUNT_TOTAL_METRICS.join(","),
      metric_type: "total_value",
      period: "day",
      since: toUnix(start),
      until: toUnix(end),
    }),
    {},
    authHeaders(token),
  );
  if (payload === null) throw new ParseError(SOURCE, "empty totals response");

  return { date: isoDate(start), values: parseTotalValue(payload) };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

interface MediaItem {
  id?: string;
  timestamp?: string;
  media_product_type?: string;
  media_type?: string;
  permalink?: string;
  caption?: string;
  insights?: InsightsPayload;
}

interface MediaPage {
  data?: MediaItem[];
  paging?: { next?: string };
}

/** A media insight is a total_value in this API, but tolerate the older shape. */
function insightValue(entry: InsightEntry): number | null {
  const total = count(entry.total_value?.value);
  if (total !== null) return total;
  return count(entry.values?.[0]?.value);
}

export function parseMediaPage(payload: unknown): InstagramPost[] {
  const items = (payload as MediaPage)?.data;
  if (!Array.isArray(items)) throw new ParseError(SOURCE, "media page has no data array");

  const posts: InstagramPost[] = [];
  for (const item of items) {
    if (typeof item?.id !== "string" || typeof item?.timestamp !== "string") {
      throw new ParseError(SOURCE, "media item is missing its id or timestamp");
    }

    const metrics: Record<string, number | null> = {};
    for (const entry of item.insights?.data ?? []) {
      if (typeof entry?.name === "string") metrics[entry.name] = insightValue(entry);
    }

    posts.push({
      mediaId: item.id,
      postedAt: item.timestamp,
      // Absent only on payloads old enough to predate reels. Recorded as
      // reported rather than guessed, since it decides which metrics exist.
      mediaProductType: item.media_product_type ?? "FEED",
      mediaType: item.media_type ?? "IMAGE",
      permalink: item.permalink ?? null,
      caption: item.caption ?? null,
      reach: metrics.reach ?? null,
      views: metrics.views ?? null,
      likes: metrics.likes ?? null,
      comments: metrics.comments ?? null,
      shares: metrics.shares ?? null,
      saved: metrics.saved ?? null,
      totalInteractions: metrics.total_interactions ?? null,
      profileVisits: metrics.profile_visits ?? null,
      follows: metrics.follows ?? null,
      avgWatchTimeMs: metrics.ig_reels_avg_watch_time ?? null,
      totalWatchTimeMs: metrics.ig_reels_video_view_total_time ?? null,
    });
  }
  return posts;
}

/**
 * Every post, or the newest few pages of them.
 *
 * Paginates by following paging.next until it stops being offered. The
 * account's own media_count is never consulted as a bound: it reports 289
 * while the cursor walks cleanly to 518, so using it would silently truncate
 * the archive at roughly half.
 */
export async function fetchInstagramPosts(
  token: string,
  options: { pages?: number } = {},
): Promise<InstagramPost[]> {
  const limit = options.pages ?? Number.POSITIVE_INFINITY;

  let url: string | null = endpoint("/me/media", {
    fields:
      "id,timestamp,media_product_type,media_type,permalink,caption," +
      `insights.metric(${MEDIA_METRICS.join(",")})`,
    limit: "100",
  });

  const posts: InstagramPost[] = [];
  const seen = new Set<string>();
  let pages = 0;

  while (url !== null && pages < limit) {
    const payload: MediaPage | null = await fetchJson<MediaPage>(url, {}, authHeaders(token));
    if (payload === null) throw new ParseError(SOURCE, "empty media page");

    for (const post of parseMediaPage(payload)) {
      // The cursor has been observed to repeat an item across a page
      // boundary. Deduplicating here keeps the upsert count honest.
      if (seen.has(post.mediaId)) continue;
      seen.add(post.mediaId);
      posts.push(post);
    }

    url = payload.paging?.next ? stripToken(payload.paging.next) : null;
    pages += 1;
  }

  return posts;
}

/** Posts still young enough for their counters to be moving. */
export function recentPosts(posts: InstagramPost[], now = Date.now()): InstagramPost[] {
  const cutoff = now - POST_METRICS_WINDOW_DAYS * 86_400_000;
  return posts.filter((post) => new Date(post.postedAt).getTime() >= cutoff);
}

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

interface BreakdownResult {
  dimension_values?: unknown[];
  value?: unknown;
}

export function parseDemographics(payload: unknown, breakdown: Breakdown): InstagramDemographic[] {
  const entry = (payload as InsightsPayload)?.data?.[0];
  const breakdowns = entry?.total_value?.breakdowns;
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) {
    throw new ParseError(SOURCE, `no ${breakdown} breakdown in response`);
  }

  const results = (breakdowns[0] as { results?: BreakdownResult[] })?.results;
  if (!Array.isArray(results)) {
    throw new ParseError(SOURCE, `${breakdown} breakdown carried no results`);
  }

  const rows: InstagramDemographic[] = [];
  for (const result of results) {
    const bucket = result?.dimension_values?.[0];
    const followers = count(result?.value);
    if (typeof bucket !== "string" || bucket.length === 0 || followers === null) continue;
    rows.push({ breakdown, bucket, followers });
  }

  if (rows.length === 0) throw new ParseError(SOURCE, `${breakdown} breakdown was empty`);
  return rows;
}

export async function fetchInstagramDemographics(token: string): Promise<InstagramDemographic[]> {
  const rows: InstagramDemographic[] = [];

  for (const breakdown of BREAKDOWNS) {
    const payload = await fetchJson(
      endpoint("/me/insights", {
        metric: "follower_demographics",
        period: "lifetime",
        metric_type: "total_value",
        breakdown: BREAKDOWN_PARAM[breakdown],
      }),
      {},
      authHeaders(token),
    );
    if (payload === null) throw new ParseError(SOURCE, `empty ${breakdown} response`);
    rows.push(...parseDemographics(payload, breakdown));
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

interface StoryItem {
  id?: string;
  timestamp?: string;
  media_type?: string;
  permalink?: string;
  insights?: InsightsPayload;
}

export function parseStories(payload: unknown): InstagramStory[] {
  const items = (payload as { data?: StoryItem[] })?.data;
  if (!Array.isArray(items)) throw new ParseError(SOURCE, "stories response has no data array");

  const stories: InstagramStory[] = [];
  for (const item of items) {
    if (typeof item?.id !== "string" || typeof item?.timestamp !== "string") {
      throw new ParseError(SOURCE, "story is missing its id or timestamp");
    }

    const metrics: Record<string, number | null> = {};
    for (const entry of item.insights?.data ?? []) {
      if (typeof entry?.name === "string") metrics[entry.name] = insightValue(entry);
    }

    stories.push({
      mediaId: item.id,
      postedAt: item.timestamp,
      mediaType: item.media_type ?? "IMAGE",
      permalink: item.permalink ?? null,
      reach: metrics.reach ?? null,
      views: metrics.views ?? null,
      replies: metrics.replies ?? null,
      shares: metrics.shares ?? null,
      totalInteractions: metrics.total_interactions ?? null,
      navigation: metrics.navigation ?? null,
    });
  }
  return stories;
}

/**
 * Whatever is live right now.
 *
 * An empty list is a normal answer, not a failure: most hours have no story
 * running. This is the one collector here whose data cannot be recovered by
 * running it again later, because the API forgets a story once it expires.
 */
export async function fetchInstagramStories(token: string): Promise<InstagramStory[]> {
  const payload = await fetchJson(
    endpoint("/me/stories", {
      fields:
        "id,timestamp,media_type,permalink," + `insights.metric(${STORY_METRICS.join(",")})`,
    }),
    {},
    authHeaders(token),
  );
  if (payload === null) throw new ParseError(SOURCE, "empty stories response");
  return parseStories(payload);
}
