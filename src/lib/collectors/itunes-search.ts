/**
 * Keyword position in App Store search.
 *
 * The iTunes Search API is not the same ranking engine as the App Store search
 * tab, so treat this as a close proxy rather than the exact number a user sees.
 * It is directionally reliable and it is the only free source, which makes it
 * worth tracking as long as nobody reports it as gospel.
 *
 * Measured 2026-08-11 in the UZ storefront: ustoz #1, ta'lim #2, talim #4, and
 * no appearance for ai, dars, maktab, matematika, or ingliz tili.
 */

import { fetchJson } from "./http";
import { IOS_APP_ID, SEARCH_LIMIT } from "./config";
import { ParseError, type KeywordRank } from "./types";

const SOURCE = "itunes-search";

interface SearchResponse {
  resultCount?: number;
  results?: { trackId?: number }[];
}

export function parseSearch(
  payload: unknown,
  keyword: string,
  country: string,
  appId: string = IOS_APP_ID,
): KeywordRank {
  const body = payload as SearchResponse;
  if (!body || !Array.isArray(body.results)) {
    throw new ParseError(SOURCE, "payload has no results array");
  }

  const index = body.results.findIndex(
    (result) => String(result?.trackId) === appId,
  );

  return {
    platform: "ios",
    storeId: appId,
    country,
    keyword,
    // null means we searched and the app did not appear in the returned set.
    position: index === -1 ? null : index + 1,
    resultCount: body.results.length,
  };
}

export async function fetchSearch(
  keyword: string,
  country: string,
  appId: string = IOS_APP_ID,
): Promise<KeywordRank> {
  const params = new URLSearchParams({
    term: keyword,
    country,
    entity: "software",
    limit: String(SEARCH_LIMIT),
  });
  const payload = await fetchJson(`https://itunes.apple.com/search?${params}`);
  return parseSearch(payload, keyword, country, appId);
}
