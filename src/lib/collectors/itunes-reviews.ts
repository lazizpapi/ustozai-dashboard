/**
 * Customer reviews from the legacy RSS.
 *
 * This feed goes intermittently empty. During testing the identical URL
 * returned 50 entries, then five consecutive responses with the entry array
 * missing entirely, then 50 again. So an empty page is never treated as proof
 * that there are no reviews: fetchReviews retries, and because reviews are only
 * ever inserted and never deleted, a flake costs us nothing but a delay.
 *
 * Pagination runs dry around page 4. Page 5 came back empty and page 11 failed
 * outright, so REVIEW_PAGES caps the walk and the daily cadence catches the rest.
 */

import {
  fetchJson,
  retryWhileEmpty,
  type EmptyRetryBudget,
  type RetryBudget,
} from "./http";
import { IOS_APP_ID, REVIEW_PAGES } from "./config";
import { ParseError, type Review } from "./types";

const SOURCE = "itunes-reviews";

interface Labelled {
  label?: string;
}

interface ReviewEntry {
  id?: Labelled;
  title?: Labelled;
  content?: Labelled;
  updated?: Labelled;
  author?: { name?: Labelled };
  "im:rating"?: Labelled;
  "im:version"?: Labelled;
}

interface ReviewsResponse {
  feed?: { entry?: ReviewEntry[] | ReviewEntry };
}

function toDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseReviews(
  payload: unknown,
  country: string,
  appId: string = IOS_APP_ID,
): Review[] {
  const body = payload as ReviewsResponse;
  if (!body?.feed) throw new ParseError(SOURCE, "payload has no feed");

  const raw = body.feed.entry;
  if (!raw) return []; // Empty feed. Valid shape, no content. See the header note.

  // A single-review page arrives as an object rather than an array.
  const entries = Array.isArray(raw) ? raw : [raw];

  return entries.flatMap((entry): Review[] => {
    const ratingLabel = entry?.["im:rating"]?.label;
    const id = entry?.id?.label;
    // The first element of some pages is app metadata, not a review. It has no
    // rating, so this filter drops it without needing to special-case index 0.
    if (!ratingLabel || !id) return [];

    const rating = Number.parseInt(ratingLabel, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return [];

    return [
      {
        platform: "ios",
        storeId: appId,
        country,
        storeReviewId: id,
        rating,
        title: entry.title?.label ?? null,
        body: entry.content?.label ?? null,
        author: entry.author?.name?.label ?? null,
        version: entry["im:version"]?.label ?? null,
        submittedAt: toDate(entry.updated?.label),
      },
    ];
  });
}

async function fetchReviewPage(
  page: number,
  country: string,
  appId: string,
  budget: RetryBudget = {},
): Promise<Review[]> {
  const url =
    `https://itunes.apple.com/${encodeURIComponent(country)}/rss/customerreviews` +
    `/page=${page}/id=${encodeURIComponent(appId)}/sortby=mostrecent/json`;
  const payload = await fetchJson(url, budget);
  return parseReviews(payload, country, appId);
}

/**
 * What the five-minute pulse may spend on page one.
 *
 * The shared defaults are sized for a caller with minutes: three empty-feed
 * attempts wrapping three fifteen second HTTP attempts comes to 141,750ms,
 * against the pulse route's thirty second ceiling. That mismatch is what was
 * killing the function seventeen times a week.
 *
 * Cut rather than removed, because the retries are not defensive noise: Apple's
 * feed genuinely returns well-formed empty pages and one retry still catches
 * the common blip. What makes cutting safe here specifically is the note below
 * on fetchLatestReviews — anything page one misses is picked up by the hourly
 * four-page walk, which keeps the generous budget.
 *
 * pulse.test.ts asserts this fits inside PULSE_DEADLINE_MS.
 */
export const PULSE_REVIEW_FETCH: EmptyRetryBudget = {
  attempts: 2,
  timeoutMs: 4_000,
  emptyAttempts: 2,
};

/**
 * Page one only, for the five-minute pulse.
 *
 * The point is latency, not coverage: a new review should reach the wall in
 * minutes rather than waiting up to an hour for the full walk. Page one sorted
 * by most recent is where a new review appears, so the other three pages would
 * be three extra requests every five minutes to re-read rows we already have.
 *
 * Nothing is lost when this misses something. Reviews are insert-only and
 * deduplicated on Apple's own id, so the hourly four-page walk backfills
 * anything that arrived faster than page one could hold it.
 *
 * That property is what licenses the tight budget: giving up early here costs
 * a delay, never a row, so the caller's deadline is the constraint that should
 * win. The budget is a default rather than a parameter the pulse passes in, so
 * that no future caller of this function can inherit the ceiling without the
 * budget that fits inside it.
 */
export async function fetchLatestReviews(
  country: string,
  appId: string = IOS_APP_ID,
  budget: EmptyRetryBudget = PULSE_REVIEW_FETCH,
): Promise<Review[]> {
  return retryWhileEmpty(
    () => fetchReviewPage(1, country, appId, budget),
    budget.emptyAttempts,
  );
}

export async function fetchReviews(
  country: string,
  appId: string = IOS_APP_ID,
): Promise<Review[]> {
  const collected = new Map<string, Review>();

  for (let page = 1; page <= REVIEW_PAGES; page += 1) {
    // Only the first page retries on empty. A later page coming back empty is
    // the expected end of the walk, not a flake worth waiting on.
    const reviews =
      page === 1
        ? await retryWhileEmpty(() => fetchReviewPage(page, country, appId))
        : await fetchReviewPage(page, country, appId);

    if (reviews.length === 0) break;
    for (const review of reviews) collected.set(review.storeReviewId, review);
  }

  return [...collected.values()];
}
