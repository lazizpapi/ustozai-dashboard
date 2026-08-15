import { fetchText } from "./http";

/**
 * Store search suggestions: what the search box offers when someone types one
 * of our tracked terms.
 *
 * This is keyword discovery straight from the source. A term appearing in the
 * suggest list is real search demand — stores only suggest what people type —
 * and a new suggestion under a seed we rank for is the cheapest early signal
 * of demand shifting.
 *
 * Apple's endpoint is the store app's own hints service (MZSearchHints), an
 * old and stable WebObjects plist endpoint; the storefront header picks the
 * country. Play's endpoint is the google-play-scraper package's suggest RPC,
 * the same library the review collector already depends on. Both verified
 * live for Uzbekistan on 2026-08-15.
 */

/** UZ storefront, software platform. Same id family the lookup responses use. */
const UZ_STOREFRONT = "143566,29";

const HINTS_URL =
  "https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?clientApplication=Software";
const TRENDS_URL =
  "https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/trends?clientApplication=Software";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * XML entities, named and numeric, in a single pass.
 *
 * Numeric forms are not optional: Apple sends them for ordinary punctuation.
 * A real suggestion on 2026-08-15 arrived as `&#34;ustoz edu&#34; nodavlat
 * ta'lim muassasasi`, and a named-entities-only decoder stored the markup
 * verbatim for the dashboard to display.
 *
 * One pass, deliberately. Decoding repeatedly would turn `&amp;amp;` — the
 * escaped form of the literal text "&amp;" — into a bare ampersand, silently
 * rewriting a term into something nobody searched for.
 */
const decodeEntities = (value: string): string =>
  value.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g,
    (match, decimal, hex, name) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;

      const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
      // Unicode tops out at 0x10FFFF; anything past it would throw.
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    },
  );

/**
 * Terms out of the hints plist, in Apple's order.
 *
 * A targeted regex rather than an XML parser: the payload is a flat, stable
 * dictionary shape, each term arriving as a `<key>term</key><string>` pair,
 * and pulling in a parser dependency for that would be all cost.
 */
export function parseAppleHints(xml: string): string[] {
  const matches = xml.matchAll(/<key>term<\/key>\s*<string>([^<]+)<\/string>/g);
  return [...matches].map((match) => decodeEntities(match[1]));
}

/**
 * Trending searches. Verified live: the endpoint answers for UZ but the list
 * is currently empty, so the populated element shape is unverified — both
 * plausible encodings are accepted and anything else is skipped. Malformed
 * bodies read as empty on purpose: trending is a bonus signal, and a broken
 * bonus must not fail the run that collects the real data.
 */
export function parseAppleTrending(body: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }

  const list = (payload as { trendingSearches?: unknown })?.trendingSearches;
  if (!Array.isArray(list)) return [];

  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const labelled = entry as { label?: unknown; term?: unknown };
    if (typeof labelled?.label === "string") return [labelled.label];
    if (typeof labelled?.term === "string") return [labelled.term];
    return [];
  });
}

/** Keeps strings, drops whatever else the unofficial library might return. */
export function parsePlaySuggest(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function fetchAppleHints(term: string): Promise<string[]> {
  const body = await fetchText(
    `${HINTS_URL}&term=${encodeURIComponent(term)}`,
    {},
    { "x-apple-store-front": UZ_STOREFRONT },
  );
  return body === null ? [] : parseAppleHints(body);
}

export async function fetchAppleTrending(): Promise<string[]> {
  const body = await fetchText(TRENDS_URL, {}, { "x-apple-store-front": UZ_STOREFRONT });
  return body === null ? [] : parseAppleTrending(body);
}

export async function fetchPlaySuggest(term: string): Promise<string[]> {
  // Same interop dance as play-reviews.ts: the package is CommonJS with an
  // ESM default, so a static import breaks under the Next server build.
  const imported = await import("google-play-scraper");
  const gplay = ((imported as { default?: unknown }).default ?? imported) as {
    suggest: (opts: { term: string; lang: string; country: string }) => Promise<unknown>;
  };

  return parsePlaySuggest(await gplay.suggest({ term, lang: "uz", country: "uz" }));
}
