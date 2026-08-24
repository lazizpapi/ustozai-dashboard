/**
 * Audience collectors: Telegram, Instagram, YouTube.
 *
 * Same shape as the store collectors: fetch, validate hard, return a typed
 * record, never touch the database. Parsing is split from fetching so every
 * parser is tested against a saved real payload with no network.
 *
 * Reliability differs sharply between the three and the code reflects that:
 *
 * Telegram is a documented Bot API call and is the sturdiest of the three.
 *
 * Instagram has no public API. The endpoint used here is the one instagram.com
 * itself calls, and it works from a residential address; Instagram routinely
 * blocks datacenter ranges, so this is expected to fail from Vercel some or all
 * of the time. It therefore validates aggressively and throws, turning a block
 * into a visible failed run instead of a silently wrong number.
 *
 * YouTube rounds every subscriber count to three significant figures, for its
 * own official API as much as for the page, so the scrape loses no precision.
 * What it does lose is stability of shape, hence the anchored parse below.
 */

import { HttpError, fetchJson, fetchText } from "./http";
import { ParseError } from "./types";

/**
 * Thrown when a host refuses us for who we are rather than what we asked.
 *
 * Instagram rate limits datacenter address ranges, so the scrape returns 200
 * from a residential connection and 429 from Vercel, reproducibly. That is a
 * known limitation of where the code runs, not a broken collector, and
 * recording it as a failure would light a permanent red warning on a wall
 * display until everyone learned to ignore warnings entirely.
 *
 * Callers record this as a skipped step. The staleness badge on the panel is
 * what tells the truth about the number being old.
 */
export class RateLimitedError extends Error {
  constructor(readonly source: string) {
    super(`${source} is rate limited from this host`);
    this.name = "RateLimitedError";
  }
}

export type SocialPlatform = "telegram" | "instagram" | "youtube";

export interface SocialSnapshot {
  platform: SocialPlatform;
  handle: string;
  followers: number;
  /** False when the platform itself publishes a rounded figure. */
  isExact: boolean;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

interface MemberCountResponse {
  ok?: boolean;
  result?: number;
  description?: string;
}

export function parseTelegramCount(payload: unknown, channel: string): SocialSnapshot {
  const body = payload as MemberCountResponse;

  if (!body?.ok || typeof body.result !== "number") {
    throw new ParseError(
      "social-telegram",
      body?.description ?? "response was not an ok member count",
    );
  }
  if (!Number.isInteger(body.result) || body.result < 0) {
    throw new ParseError("social-telegram", `implausible count ${body.result}`);
  }

  return { platform: "telegram", handle: channel, followers: body.result, isExact: true };
}

export async function fetchTelegramMembers(
  channel: string,
  botToken: string,
): Promise<SocialSnapshot> {
  const url =
    `https://api.telegram.org/bot${botToken}/getChatMemberCount` +
    `?chat_id=${encodeURIComponent(`@${channel}`)}`;
  return parseTelegramCount(await fetchJson(url), channel);
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

interface InstagramResponse {
  data?: {
    user?: {
      username?: string;
      edge_followed_by?: { count?: number };
    };
  };
}

export function parseInstagramProfile(payload: unknown, expected: string): SocialSnapshot {
  const user = (payload as InstagramResponse)?.data?.user;
  if (!user) {
    throw new ParseError("social-instagram", "payload has no user node");
  }

  // The username must echo back. A block or a redirect can return a
  // well-formed body for something else entirely, and silently recording
  // another account's follower count would be worse than recording nothing.
  if (typeof user.username !== "string" || user.username.toLowerCase() !== expected.toLowerCase()) {
    throw new ParseError(
      "social-instagram",
      `expected profile ${expected}, got ${String(user.username)}`,
    );
  }

  const followers = user.edge_followed_by?.count;
  if (typeof followers !== "number" || !Number.isInteger(followers) || followers < 0) {
    throw new ParseError("social-instagram", `follower count is not valid: ${String(followers)}`);
  }

  return { platform: "instagram", handle: expected, followers, isExact: true };
}

export async function fetchInstagramFollowers(handle: string): Promise<SocialSnapshot> {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

  let payload: unknown;
  try {
    payload = await fetchJson(
      url,
      { browserUa: true },
      // instagram.com sends this app id on its own web requests. Without it the
      // endpoint answers with a login wall rather than the profile.
      { "x-ig-app-id": "936619743392459", referer: "https://www.instagram.com/" },
    );
  } catch (error) {
    // http.ts already retried this three times with backoff. A 429 surviving
    // that is the address being refused, not a transient blip.
    if (error instanceof HttpError && error.status === 429) {
      throw new RateLimitedError("instagram");
    }
    throw error;
  }

  if (payload === null) throw new ParseError("social-instagram", "empty response");
  return parseInstagramProfile(payload, handle);
}

interface InstagramApiResponse {
  followers_count?: number;
  username?: string;
}

export function parseInstagramApi(payload: unknown, handle: string): SocialSnapshot {
  const body = payload as InstagramApiResponse;
  const followers = body?.followers_count;

  if (typeof followers !== "number" || !Number.isInteger(followers) || followers < 0) {
    throw new ParseError("social-instagram", `API returned no usable count: ${String(followers)}`);
  }

  // The API answers for whichever account authorised the token, so prefer the
  // username it reports over the one we asked for. If they ever diverge, the
  // token belongs to a different account and the stored handle would be a lie.
  return {
    platform: "instagram",
    handle: body.username ?? handle,
    followers,
    isExact: true,
  };
}

/**
 * The official route: Instagram API with Instagram Login.
 *
 * Works from anywhere, including Vercel, because it authenticates as the
 * account rather than pretending to be a browser. Requires a professional
 * account, which @ustozai already is (Creator), and notably no linked Facebook
 * Page under this API.
 */
export async function fetchInstagramViaApi(
  token: string,
  handle: string,
): Promise<SocialSnapshot> {
  const url = "https://graph.instagram.com/v23.0/me?fields=followers_count,username";

  /*
   * The credential travels in a header, not the query string.
   *
   * HttpError's message is `${url} returned ${status}`, run-step writes that
   * message into collector_runs, and collector_runs grants authenticated read
   * to every signed-in user. With the token in the URL, one 5xx from Meta
   * publishes a live sixty-day credential to everyone holding any department
   * password. Meta accepts bearer auth on this endpoint, so the whole class of
   * accident is avoidable rather than something to remember to redact.
   */
  const payload = await fetchJson(url, {}, { Authorization: `Bearer ${token}` });
  if (payload === null) throw new ParseError("social-instagram", "empty API response");
  return parseInstagramApi(payload, handle);
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

/** "53K" -> 53000, "1.2M" -> 1200000, "174" -> 174. */
export function parseCompactCount(raw: string): number | null {
  const match = raw.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;

  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    (match[2] ?? "").toUpperCase() as "K" | "M" | "B"
  ];
  return Math.round(value * (multiplier ?? 1));
}

/**
 * Pull the subscriber count out of a channel page.
 *
 * Anchored deliberately, and this is not theoretical. A channel page embeds
 * other channels' counts in its recommendation shelves, so a loose
 * /([\d.]+[KMB]?) subscribers/ scan finds thirteen matches on @UstozAI and the
 * first one is 53K, belonging to a suggested channel. The real figure, 174K,
 * appears only inside the header metadata. The loose version would have
 * silently reported a number three times too small.
 */
export function parseYoutubeSubscribers(html: string, handle: string): SocialSnapshot {
  const patterns = [
    // Current channel header shape, verified against the live page.
    /"metadataParts":\[\{"text":\{"content":"([\d.,]+[KMB]?) subscribers"/,
    // Older shapes, still served to some clients.
    /"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([\d.,]+[KMB]?) (?:million |thousand )?subscribers"/,
    /"subscriberCountText":\{"simpleText":"([\d.,]+[KMB]?) subscribers"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const followers = parseCompactCount(match[1]);
    if (followers !== null && followers > 0) {
      // YouTube rounds to three significant figures everywhere, official API
      // included, so this is as precise as the number gets.
      return { platform: "youtube", handle, followers, isExact: false };
    }
  }

  throw new ParseError(
    "social-youtube",
    "no subscriber count in the channel header; the page shape likely changed",
  );
}

interface YoutubeApiResponse {
  items?: { statistics?: { subscriberCount?: string } }[];
}

export function parseYoutubeApi(payload: unknown, handle: string): SocialSnapshot {
  const raw = (payload as YoutubeApiResponse)?.items?.[0]?.statistics?.subscriberCount;
  const followers = Number.parseInt(String(raw), 10);

  if (!Number.isFinite(followers) || followers < 0) {
    throw new ParseError("social-youtube", `API returned no usable count: ${String(raw)}`);
  }
  // Still rounded: the Data API applies the same three-significant-figure rule.
  return { platform: "youtube", handle, followers, isExact: false };
}

export async function fetchYoutubeSubscribers(
  handle: string,
  apiKey: string | null,
): Promise<SocialSnapshot> {
  if (apiKey) {
    const url =
      "https://www.googleapis.com/youtube/v3/channels" +
      `?part=statistics&forHandle=${encodeURIComponent(`@${handle}`)}&key=${apiKey}`;
    const payload = await fetchJson(url);
    if (payload === null) throw new ParseError("social-youtube", "empty API response");
    return parseYoutubeApi(payload, handle);
  }

  const html = await fetchText(
    `https://www.youtube.com/@${encodeURIComponent(handle)}`,
    { browserUa: true },
    { "accept-language": "en-US,en;q=0.9" },
  );
  if (html === null) throw new ParseError("social-youtube", "empty channel page");
  return parseYoutubeSubscribers(html, handle);
}
