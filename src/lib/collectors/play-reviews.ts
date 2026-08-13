/**
 * Google Play reviews.
 *
 * The only qualitative signal the Android half of this dashboard has. Play
 * publishes ratings and a star histogram on the listing page, which
 * play-details.ts already reads, but not a word of what anyone actually wrote.
 *
 * Fetched through google-play-scraper rather than by hand. Play serves reviews
 * from a batchexecute RPC whose payload is a deeply nested positional array
 * with no names, and unlike the ds:5 block in play-details.ts, that one is
 * paginated and changes shape more often. The package tracks those changes
 * upstream, which is exactly the trade its own header comment in
 * play-details.ts anticipated.
 *
 * Using a package does not mean trusting it. Its return value is treated as an
 * untrusted boundary payload and validated as hard as anything fetched over
 * the wire, so parsePlayReviews stays pure and fixture-testable and a change
 * in the package's output shape becomes a loud failure rather than a silently
 * emptier review list.
 */

import { HttpError } from "./http";
import { RateLimitedError } from "./social";
import { ANDROID_PACKAGE, PLAY_REVIEW_COUNT } from "./config";
import { ParseError, type Review } from "./types";

const SOURCE = "play-reviews";

/** Shape we rely on. Everything is optional here so validation can say why. */
interface PlayReviewEntry {
  id?: unknown;
  userName?: unknown;
  date?: unknown;
  score?: unknown;
  title?: unknown;
  text?: unknown;
  version?: unknown;
}

/** Play returns an ISO string today, but has returned Date objects before. */
function toDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Empty strings become null: Play sends "" for an absent version, not undefined. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate and map. Throws rather than skipping bad entries, because the
 * realistic failure here is the package changing its field names, and that
 * would turn every entry bad at once. Silently returning an empty list would
 * look exactly like an app nobody has reviewed lately.
 */
export function parsePlayReviews(
  payload: unknown,
  lang: string,
  packageName: string = ANDROID_PACKAGE,
): Review[] {
  if (!Array.isArray(payload)) {
    throw new ParseError(SOURCE, `expected an array of reviews, got ${typeof payload}`);
  }

  return payload.map((raw, index): Review => {
    const entry = raw as PlayReviewEntry;

    const storeReviewId = entry?.id;
    if (typeof storeReviewId !== "string" || storeReviewId.length === 0) {
      throw new ParseError(SOURCE, `review ${index} has no usable id`);
    }

    const rating = entry.score;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ParseError(SOURCE, `review ${storeReviewId} has rating ${String(rating)}`);
    }

    return {
      platform: "android",
      storeId: packageName,
      /*
       * The language, not a country. Play exposes no reviewer location at all,
       * and inventing one would be worse than recording the axis we actually
       * queried on. The reviews.country column comment carries the same note.
       */
      country: lang,
      storeReviewId,
      rating,
      // Play has no review titles. Kept in the shape for the shared Review type.
      title: text(entry.title),
      body: text(entry.text),
      author: text(entry.userName),
      version: text(entry.version),
      submittedAt: toDate(entry.date),
    };
  });
}

export async function fetchPlayReviews(
  lang: string,
  packageName: string = ANDROID_PACKAGE,
): Promise<Review[]> {
  /*
   * Imported lazily and normalised for both module shapes. The package is
   * published as CommonJS with an ESM interop default, so a static import
   * resolves differently depending on how the route is bundled.
   */
  const imported = await import("google-play-scraper");
  const gplay = (imported as { default?: unknown }).default ?? imported;
  const api = gplay as {
    reviews: (options: Record<string, unknown>) => Promise<unknown>;
    sort?: { NEWEST?: number };
  };

  let result: unknown;
  try {
    result = await api.reviews({
      appId: packageName,
      lang,
      // The storefront to query. Fixed to uz: this dashboard tracks the Uzbek
      // market, and the language is what varies between calls.
      country: "uz",
      sort: api.sort?.NEWEST ?? 2,
      num: PLAY_REVIEW_COUNT,
    });
  } catch (error) {
    /*
     * Play may refuse datacenter addresses for this RPC even though the plain
     * listing GET in play-details.ts succeeds from the same host. Classified
     * the same way Instagram is: a block is a fact about where we run, not a
     * broken collector, and it should read as skipped rather than lighting a
     * permanent red on the wall.
     */
    if (error instanceof HttpError && error.status === 429) {
      throw new RateLimitedError(SOURCE);
    }
    if (error instanceof Error && /\b429\b|too many requests/i.test(error.message)) {
      throw new RateLimitedError(SOURCE);
    }
    throw error;
  }

  // The package returns {data, nextPaginationToken}; older majors returned the
  // array directly. Accept both rather than pinning to one.
  const entries = (result as { data?: unknown })?.data ?? result;
  return parsePlayReviews(entries, lang, packageName);
}
