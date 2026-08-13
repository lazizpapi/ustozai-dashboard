/**
 * What we track, and where.
 *
 * Every value here was verified live against the real endpoints before being
 * written down. The measurements in the comments are from 2026-08-11 and are
 * there so a future reader can tell "this changed" from "this never worked".
 */

export const IOS_APP_ID = "6504815934";
export const ANDROID_PACKAGE = "uz.uztozedu.ustozai";

/** Apple genre id for Education. */
export const EDUCATION_GENRE = "6017";

/** Sentinel for the ungenred chart. See the chart_ranks.genre column comment. */
export const OVERALL_GENRE = "overall";

/**
 * Storefronts worth polling. Uzbekistan carries 1178 of roughly 1263 total iOS
 * ratings, so it is the only market where chart position is meaningful today.
 * The rest are tracked because they are cheap and because a spike in any of
 * them is worth noticing early.
 */
export const COUNTRIES = ["uz", "us", "ru", "kz"] as const;
export type Country = (typeof COUNTRIES)[number];

/** Chart position is only polled where the app plausibly ranks. */
export const CHART_COUNTRIES: Country[] = ["uz"];

export const CHART_TYPES = [
  { key: "topfree", feed: "topfreeapplications", genre: EDUCATION_GENRE },
  { key: "topfreeipad", feed: "topfreeipadapplications", genre: EDUCATION_GENRE },
  { key: "topgrossing", feed: "topgrossingapplications", genre: EDUCATION_GENRE },
  { key: "topfree", feed: "topfreeapplications", genre: OVERALL_GENRE },
] as const;

/**
 * Search terms, tracked in the UZ storefront.
 *
 * Both apostrophe forms of "ta'lim" are here on purpose. Uzbek Latin
 * orthography uses U+02BC for the glottal stop, but almost nobody types it on a
 * phone keyboard, and Apple returns different result sets for the two strings.
 * Tracking only the correct one would report a rank most users never see.
 *
 * Measured on 2026-08-11: ustoz #1, ta'lim #2, talim #4. The remainder are
 * watch terms where the app does not currently appear at all, kept so that
 * first appearance is visible rather than invisible.
 */
export const KEYWORDS = [
  "ustoz",
  "ta'lim",
  "taʼlim",
  "talim",
  "ai",
  "dars",
  "maktab",
  "matematika",
  "ingliz tili",
] as const;

/**
 * Apple caps the legacy RSS at 100 entries whatever limit you ask for. Asking
 * for 200 returns 100 from itunes.apple.com and a 500 from the newer
 * rss.marketingtools.apple.com host, so 100 is the real ceiling.
 */
export const CHART_FEED_LIMIT = 100;

/** iTunes Search returns at most 200; 100 is plenty to place a single app. */
export const SEARCH_LIMIT = 100;

/**
 * The reviews RSS runs dry somewhere around page 4. Page 5 came back empty and
 * page 11 failed outright during testing, so we stop at 4 and rely on running
 * daily to catch anything newer.
 */
export const REVIEW_PAGES = 4;

/**
 * Play review languages, not countries.
 *
 * Google filters reviews by the language they were written in and publishes no
 * reviewer country at all, so these are the two axes worth querying for an
 * Uzbek app: reviews are written in Uzbek and in Russian, and asking for one
 * returns nothing written in the other. Verified 2026-08-13.
 */
export const PLAY_REVIEW_LANGS = ["uz", "ru"] as const;

/** One page. Deduplication on Play's own review id makes overlap free. */
export const PLAY_REVIEW_COUNT = 100;
