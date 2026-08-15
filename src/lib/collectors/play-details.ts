/**
 * Google Play app details.
 *
 * Play is the more generous of the two stores: it publishes an exact cumulative
 * install count with no credentials at all. Measured 2026-08-11 for
 * uz.uztozedu.ustozai: 530,577 installs, 4.76 from 10,288 ratings. Apple
 * publishes no equivalent number at any tier, which is why the iOS side of this
 * dashboard needs an App Store Connect key and the Android side does not.
 *
 * The number is not in the HTML as text. It lives in an AF_initDataCallback
 * block keyed "ds:5" holding a deeply nested positional array. Those positions
 * are an internal detail of Play's frontend and will move eventually, so
 * parsePlayDetails validates hard and throws rather than returning nulls. A
 * throw becomes a failed collector_runs row and a visible staleness badge; a
 * silent null would look like a real zero.
 *
 * If these positions start shifting often, the maintained alternative is the
 * google-play-scraper package, which tracks Play's layout changes upstream.
 */

import { fetchText } from "./http";
import { ANDROID_PACKAGE } from "./config";
import { ParseError, type MetricSnapshot } from "./types";

const SOURCE = "play-details";

/** Verified positions inside ds:5, relative to data[1][2]. */
const PATH = {
  name: [0, 0],
  installsExact: [13, 2],
  installsLabel: [13, 3],
  rating: [51, 0, 1],
  ratingCount: [51, 2, 1],
  histogram: [51, 1],
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

/** Pull the ds:5 payload out of the page's inline bootstrap scripts. */
export function extractDs5(html: string): unknown {
  const blocks = html.match(/AF_initDataCallback\(\{.*?\}\);<\/script>/gs) ?? [];
  const block = blocks.find((candidate) => candidate.includes("key: 'ds:5'"));
  if (!block) {
    throw new ParseError(SOURCE, "no ds:5 bootstrap block in the page");
  }

  const data = block.match(/data:(\[.*\]),\s*sideChannel/s);
  if (!data) {
    throw new ParseError(SOURCE, "ds:5 block has no data array");
  }

  try {
    return JSON.parse(data[1]);
  } catch {
    throw new ParseError(SOURCE, "ds:5 data array is not valid JSON");
  }
}

export function parsePlayDetails(
  html: string,
  country: string,
  packageName: string = ANDROID_PACKAGE,
): MetricSnapshot {
  const root = at(extractDs5(html), [1, 2]);
  if (root === undefined) {
    throw new ParseError(SOURCE, "ds:5 has no app node at [1][2]");
  }

  const installCount = at(root, PATH.installsExact);
  const rating = at(root, PATH.rating);
  const ratingCount = at(root, PATH.ratingCount);

  // Validate loudly. A layout shift shows up here as a throw, which is what we
  // want: a wrong number is far worse than a visibly missing one.
  if (typeof installCount !== "number" || !Number.isInteger(installCount) || installCount < 0) {
    throw new ParseError(SOURCE, `install count is not a positive integer: ${String(installCount)}`);
  }
  if (typeof rating !== "number" || rating < 0 || rating > 5) {
    throw new ParseError(SOURCE, `rating outside 0..5: ${String(rating)}`);
  }
  if (typeof ratingCount !== "number" || !Number.isInteger(ratingCount) || ratingCount < 0) {
    throw new ParseError(SOURCE, `rating count is not a positive integer: ${String(ratingCount)}`);
  }

  const installLabel = at(root, PATH.installsLabel);
  const version = at(root, PATH.version);

  return {
    platform: "android",
    storeId: packageName,
    country,
    rating,
    ratingCount,
    installCount,
    installLabel: typeof installLabel === "string" ? installLabel : null,
    version: typeof version === "string" ? version : null,
  };
}

/**
 * Star histogram, 1 through 5. Its sum should land within about a percent of
 * ratingCount; a wide gap is a hint that the positions have drifted even when
 * the individual values still look plausible.
 */
export function parseRatingHistogram(html: string): Record<number, number> {
  const root = at(extractDs5(html), [1, 2]);
  const histogram: Record<number, number> = {};
  for (let stars = 1; stars <= 5; stars += 1) {
    const value = at(root, [...PATH.histogram, stars, 1]);
    histogram[stars] = typeof value === "number" ? value : 0;
  }
  return histogram;
}

/**
 * The raw listing page, exposed so one fetch can feed several parsers.
 * The poll reads it twice: parsePlayDetails for the install snapshot and
 * parsePlayListing for listing-change tracking.
 */
export async function fetchPlayPage(
  country: string,
  packageName: string = ANDROID_PACKAGE,
): Promise<string> {
  const params = new URLSearchParams({ id: packageName, hl: "en", gl: country.toUpperCase() });
  const html = await fetchText(
    `https://play.google.com/store/apps/details?${params}`,
    { browserUa: true },
  );
  if (html === null) throw new ParseError(SOURCE, "empty response from Play");
  return html;
}

export async function fetchPlayDetails(
  country: string,
  packageName: string = ANDROID_PACKAGE,
): Promise<MetricSnapshot> {
  return parsePlayDetails(await fetchPlayPage(country, packageName), country, packageName);
}
