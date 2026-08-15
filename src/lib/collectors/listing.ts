import { createHash } from "node:crypto";

import { extractDs5 } from "./play-details";
import { ANDROID_PACKAGE, IOS_APP_ID } from "./config";
import type { Platform } from "./types";

/**
 * Listing-change tracking, Asomobile's "Spy" tools reduced to what matters.
 *
 * A competitor changing their title, description or screenshots is an ASO
 * experiment being run in public, and it is the earliest visible signal of
 * their strategy. Both sources here are pages the poll already fetches — the
 * iTunes lookup and the Play details HTML — so watching costs no requests.
 *
 * The single rule: hash stable metadata only. Ratings and install counts drift
 * on their own every hour; letting them into the hash would file a "listing
 * change" on every poll and bury the real events under noise.
 */

export type ListingFields = Record<string, string | string[] | null>;

export interface ListingRecord {
  platform: Platform;
  storeId: string;
  fields: ListingFields;
  contentHash: string;
}

/**
 * Order-independent, and null-equals-absent.
 *
 * The second property is what keeps a parser regression from flapping: if a
 * field's position in Play's payload shifts, the field becomes null, which
 * registers as one change and then stays quiet, rather than alternating with
 * every deploy that does or does not read it.
 */
export function hashListing(fields: ListingFields): string {
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

interface LookupListingResult {
  trackId?: number;
  trackName?: string;
  description?: string;
  version?: string;
  releaseNotes?: string;
  screenshotUrls?: unknown;
  artworkUrl512?: string;
}

interface LookupListingResponse {
  results?: LookupListingResult[];
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;

/**
 * Listing fields out of a lookup response the poll already holds.
 *
 * Screenshot and icon URLs are content-addressed on Apple's CDN — the path
 * contains an asset id that changes only when a new image is uploaded — which
 * is what makes URL comparison a faithful proxy for "the screenshots changed".
 * Apple's lookup exposes no subtitle at all, so that one change stays
 * invisible to us; the fields below are the complete visible set.
 *
 * Returns null when the storefront does not carry the app, matching
 * parseLookup's convention for the same payload.
 */
export function parseIosListing(
  payload: unknown,
  appId: string = IOS_APP_ID,
): ListingRecord | null {
  const body = payload as LookupListingResponse;
  const app = Array.isArray(body?.results) ? body.results[0] : undefined;
  if (!app) return null;

  const fields: ListingFields = {
    title: str(app.trackName),
    description: str(app.description),
    version: str(app.version),
    releaseNotes: str(app.releaseNotes),
    screenshots: strings(app.screenshotUrls),
    icon: str(app.artworkUrl512),
  };

  return {
    platform: "ios",
    // The requested id, never a hardcoded fallback: a competitor payload
    // missing trackId must not be filed under our app.
    storeId: String(app.trackId ?? appId),
    fields,
    contentHash: hashListing(fields),
  };
}

/** Verified positions inside ds:5, relative to data[1][2]. See play-details.ts. */
const PLAY_LISTING_PATH = {
  title: [0, 0],
  description: [72, 0, 1],
  version: [140, 0, 0, 0],
} as const;

function at(root: unknown, path: readonly number[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!Array.isArray(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Best-effort on purpose, unlike parsePlayDetails' hard validation.
 *
 * This runs on the same HTML in the same step as the details parse, which
 * already throws loudly on a layout shift. A missing field here degrades to
 * null — one recorded change, then quiet — because a listing watcher that
 * fails the whole poll over a moved description would cost real data to
 * protect a nice-to-have.
 */
export function parsePlayListing(
  html: string,
  packageName: string = ANDROID_PACKAGE,
): ListingRecord {
  const root = at(extractDs5(html), [1, 2]);

  const fields: ListingFields = {
    title: str(at(root, PLAY_LISTING_PATH.title)),
    description: str(at(root, PLAY_LISTING_PATH.description)),
    version: str(at(root, PLAY_LISTING_PATH.version)),
  };

  return {
    platform: "android",
    storeId: packageName,
    fields,
    contentHash: hashListing(fields),
  };
}
