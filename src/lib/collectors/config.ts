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

/** Play's own name for the Education category, used where Apple uses 6017. */
export const PLAY_EDUCATION_CATEGORY = "EDUCATION";

/**
 * The Play charts worth polling.
 *
 * Genre strings are namespaced per store rather than shared: Apple numbers its
 * genres, Google names them, and the two never collide because chart_ranks
 * rows are separated by app_id and every app row carries its platform.
 *
 * Measured 2026-08-24, UZ: Education #5, and outside the top 100 overall. The
 * shape matches Apple exactly, which is why the overall chart is worth keeping
 * even though the app does not appear in it.
 */
export const PLAY_CHART_TYPES = [
  {
    key: "topfree",
    collection: "TOP_FREE",
    category: PLAY_EDUCATION_CATEGORY,
    genre: PLAY_EDUCATION_CATEGORY,
  },
  { key: "topfree", collection: "TOP_FREE", category: undefined, genre: OVERALL_GENRE },
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

export interface Competitor {
  /** Stable key for health-panel step names and table rows. */
  slug: string;
  name: string;
  /** Null when the app is not on that store. */
  iosId: string | null;
  androidPackage: string | null;
}

/**
 * The apps worth watching, chosen from the live UZ Education chart on
 * 2026-08-13, when Ustoz AI sat at #21.
 *
 * Picked for comparability rather than for proximity in the chart. The
 * positions above us are thick with driving-test apps and astronomy apps, which
 * share a chart and nothing else. These five are education products competing
 * for the same students.
 *
 * Their standing that day, which is the baseline every later reading is
 * measured against:
 *
 *   #4  InTalim Students      360,985 installs   4.42 Play   3.70 iOS
 *   #5  Qizlar Akademiyasi    429,181 installs   4.20 Play   4.61 iOS
 *   #9  Praktika AI Tutor  19,607,405 installs   4.51 Play   4.68 iOS
 *   #13 Ibrat Academy       3,305,898 installs   4.68 Play   4.60 iOS
 *   #16 Englify               493,021 installs   4.68 Play   4.46 iOS
 *   #21 Ustoz AI              531,001 installs   4.76 Play   4.68 iOS
 *
 * Worth keeping in view: three of the five rank above us with fewer installs.
 * Apple's chart follows recent download velocity, not accumulated size, so the
 * position is a momentum reading rather than a size ranking.
 *
 * Praktika is a global app rather than a local rival and is tracked as the
 * category's ceiling, not as a like-for-like comparison.
 *
 * Only the UZ storefront is ever polled for these. This list must stay in step
 * with the seed in migration 0008; if it drifts, the poll says so loudly,
 * because persist throws on an unknown platform and store id pair.
 */
export const COMPETITORS: readonly Competitor[] = [
  {
    slug: "intalim",
    name: "InTalim Students",
    iosId: "6504232456",
    androidPackage: "uz.intalim",
  },
  {
    slug: "qizlar-akademiyasi",
    name: "Qizlar Akademiyasi",
    iosId: "6557054918",
    androidPackage: "uz.globalmove.girls_academy",
  },
  {
    slug: "praktika",
    name: "Praktika AI Tutor",
    iosId: "1624701477",
    androidPackage: "ai.praktika.android",
  },
  {
    slug: "ibrat-academy",
    name: "Ibrat Academy",
    iosId: "6447472950",
    androidPackage: "uz.ibrat.farzandlari",
  },
  {
    slug: "englify",
    name: "Englify",
    iosId: "6499320034",
    androidPackage: "uz.englify.englify_client_mobile",
  },
] as const;
