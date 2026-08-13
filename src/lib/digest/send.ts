import "server-only";

import { formatDigest, type DigestInput } from "./format";
import { telegramEnv } from "@/lib/env";
import { ESCALATE_WHEN_DAYS_LEFT, daysUntilExpiry, loadToken } from "@/lib/db/tokens";
import {
  androidDailyInstalls,
  collectorHealth,
  iosDailyDownloads,
  rankTrend,
  ratingTrend,
  recentReviews,
  socialTrends,
} from "@/lib/db/queries";

/**
 * Assembles and sends the daily digest.
 *
 * Returns rather than throws when Telegram is unconfigured, so a project
 * without a bot token still runs its collectors cleanly instead of logging a
 * failure every morning.
 */

export interface DigestResult {
  sent: boolean;
  reason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function gather(): Promise<DigestInput> {
  const since = new Date(Date.now() - DAY_MS).toISOString();

  const [rank, ios, android, iosDownloads, androidInstalls, reviews, health, audience] =
    await Promise.all([
      rankTrend(),
      ratingTrend("ios"),
      ratingTrend("android"),
      iosDailyDownloads(7),
      androidDailyInstalls(7),
      // The day's window is a condition on the query, not a slice of the
      // newest N. Two stores feed this now, and a busy day on one could
      // otherwise push the other out of the list before the filter ran.
      recentReviews(200, since),
      collectorHealth(),
      socialTrends(),
    ]);

  // Only surfaced once it is close enough to matter. A token with a month left
  // is not news and would train people to skim past the action section.
  const token = await loadToken("instagram").catch(() => null);
  const remaining = token ? daysUntilExpiry(token) : null;
  const tokenExpiresInDays =
    remaining !== null && remaining < ESCALATE_WHEN_DAYS_LEFT ? remaining : null;

  const newReviews = reviews.map((review) => ({
    rating: review.rating,
    title: review.title,
    body: review.body,
    country: review.country,
    // Carried through now that both stores feed this. A one star review that
    // does not say which store it came from sends somebody to the wrong place.
    platform: review.platform,
  }));

  const lastIos = iosDownloads.at(-1) ?? null;
  const lastAndroid = androidInstalls.at(-1) ?? null;

  return {
    date: new Date().toISOString().slice(0, 10),
    rank: { current: rank.current, previous: rank.previous, feedSize: rank.feedSize },
    iosRating: { current: ios.current, previous: ios.previous, count: ios.ratingCount },
    androidRating: {
      current: android.current,
      previous: android.previous,
      count: android.ratingCount,
    },
    iosDownloads: lastIos ? { date: lastIos.date, units: lastIos.downloads } : null,
    androidInstalls: lastAndroid
      ? { date: lastAndroid.date, units: lastAndroid.installs }
      : null,
    newReviews,
    tokenExpiresInDays,
    audience: audience.map((row) => ({
      platform: row.platform,
      current: row.current,
      previous: row.previous,
      isExact: row.isExact,
    })),
    failures: health
      .filter((source) => source.status === "failed")
      .map((source) => `${source.source}: ${source.error ?? "failed"}`),
  };
}

export async function sendDailyDigest(): Promise<DigestResult> {
  const config = telegramEnv();
  if (!config) return { sent: false, reason: "Telegram is not configured" };

  const message = formatDigest(await gather());

  const response = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { sent: false, reason: `Telegram ${response.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}
