/**
 * iTunes Lookup: rating, rating count, and current version per storefront.
 *
 * Public, unauthenticated, and per-country. Measured 2026-08-11 for id
 * 6504815934: uz 4.69 from 1178 ratings, us 4.59 from 49, ru 4.55 from 29,
 * kz 4.43 from 7.
 */

import { fetchJson } from "./http";
import { IOS_APP_ID } from "./config";
import { ParseError, type MetricSnapshot } from "./types";

const SOURCE = "itunes-lookup";

interface LookupResult {
  averageUserRating?: number;
  userRatingCount?: number;
  version?: string;
  trackId?: number;
}

interface LookupResponse {
  resultCount?: number;
  results?: LookupResult[];
}

/**
 * Returns null when the app is not sold in that storefront, which is an
 * ordinary answer rather than a failure. Throws when the payload is not a
 * lookup response at all.
 */
export function parseLookup(
  payload: unknown,
  country: string,
  appId: string = IOS_APP_ID,
): MetricSnapshot | null {
  const body = payload as LookupResponse;
  if (!body || !Array.isArray(body.results)) {
    throw new ParseError(SOURCE, "payload has no results array");
  }
  const app = body.results[0];
  if (!app) return null;

  return {
    platform: "ios",
    /*
     * Falls back to the id that was asked for, not to ours.
     *
     * This is now polled for competitors too. A response missing trackId would
     * previously have been filed against the Ustoz AI row, quietly overwriting
     * our rating with somebody else's, and every panel downstream would have
     * shown it without complaint.
     */
    storeId: String(app.trackId ?? appId),
    country,
    rating: typeof app.averageUserRating === "number" ? app.averageUserRating : null,
    ratingCount: typeof app.userRatingCount === "number" ? app.userRatingCount : null,
    installCount: null,
    installLabel: null,
    version: app.version ?? null,
  };
}

/**
 * The raw lookup response, exposed so one fetch can feed several parsers.
 * The poll reads it twice: parseLookup for the rating snapshot and
 * parseIosListing for listing-change tracking.
 */
export async function fetchLookupPayload(
  country: string,
  appId: string = IOS_APP_ID,
): Promise<unknown> {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${encodeURIComponent(country)}`;
  return fetchJson(url);
}

export async function fetchLookup(
  country: string,
  appId: string = IOS_APP_ID,
): Promise<MetricSnapshot | null> {
  return parseLookup(await fetchLookupPayload(country, appId), country, appId);
}
