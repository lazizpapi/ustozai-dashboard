import type { Role } from "./roles";

/**
 * The dashboard's stable names for the figures it tracks.
 *
 * A tile, a movement rule, a stored note and a chat question all have to agree
 * on what "the App Store rating" is called, and until now nothing named it:
 * each of those places carried its own English label and they only matched by
 * hand. A note written against "App Store rating" and a tile labelled "App
 * Store rating, daily" would simply never meet, and nothing would report the
 * mismatch.
 *
 * So the key is the identity and the labels are decoration. Rename a tile
 * freely; the key underneath it is what the note was filed against.
 *
 * This module deliberately imports nothing but the role type. It is read by the
 * collectors on the server and by the note marker in the browser, and a stray
 * import of the database client here would drag Supabase into the client
 * bundle.
 */

export const METRIC_KEYS = [
  "ios_downloads",
  "android_installs",
  "education_rank_ios",
  "education_rank_android",
  "ios_rating",
  "android_rating",
  "revenue",
  "active_users",
  "telegram_members",
  "instagram_followers",
  "youtube_subscribers",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === "string" && (METRIC_KEYS as readonly string[]).includes(value);
}

/**
 * `android_installs` has a key but no movement rule, on purpose.
 *
 * Play reports installs as a running total that lands in batches, so the daily
 * figure is a difference between two readings rather than a day's count. A
 * batch that covers three days reads as one enormous day followed by two empty
 * ones, and any surge or slump rule would fire on the seam rather than on
 * anything that happened to the app. The key exists so a note can be attached
 * by hand or by a later rule that understands the batching.
 */

/** English, matching the tile labels so a note and its tile read alike. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  ios_downloads: "App Store downloads",
  android_installs: "Google Play installs",
  education_rank_ios: "Education, App Store",
  education_rank_android: "Education, Google Play",
  ios_rating: "App Store rating",
  android_rating: "Google Play rating",
  revenue: "Takings",
  active_users: "Daily active",
  telegram_members: "Telegram members",
  instagram_followers: "Instagram followers",
  youtube_subscribers: "YouTube subscribers",
};

/** Uzbek, for the note feed, where the writing around them is Uzbek too. */
export const METRIC_LABELS_UZ: Record<MetricKey, string> = {
  ios_downloads: "App Store yuklab olishlari",
  android_installs: "Google Play o'rnatishlari",
  education_rank_ios: "Education o'rni, App Store",
  education_rank_android: "Education o'rni, Google Play",
  ios_rating: "App Store bahosi",
  android_rating: "Google Play bahosi",
  revenue: "Tushum",
  active_users: "Faol foydalanuvchilar",
  telegram_members: "Telegram obunachilari",
  instagram_followers: "Instagram obunachilari",
  youtube_subscribers: "YouTube obunachilari",
};

/**
 * The company's takings, which no department password unlocks.
 *
 * The same line `canSee` draws around "/business", drawn again here because a
 * note travels further than the page it was written for: it appears on a tile,
 * in a feed and in an answer, and each of those is a separate chance to hand a
 * department the figure the page itself refuses them.
 */
export const CEO_ONLY_KEYS: readonly MetricKey[] = ["revenue"];

/**
 * Which notes a role may read.
 *
 * Fails closed the way `canSee` does: an absent role is treated as a
 * department rather than as the CEO, so a session that expired mid-request
 * loses the finances rather than gaining them.
 */
export function visibleKeys(role: Role | null): MetricKey[] {
  if (role === "ceo") return [...METRIC_KEYS];
  return METRIC_KEYS.filter((key) => !CEO_ONLY_KEYS.includes(key));
}

/** The audience pages key their tiles by platform; notes key by metric. */
export const SOCIAL_PLATFORM_KEYS = {
  telegram: "telegram_members",
  instagram: "instagram_followers",
  youtube: "youtube_subscribers",
} as const satisfies Record<string, MetricKey>;
