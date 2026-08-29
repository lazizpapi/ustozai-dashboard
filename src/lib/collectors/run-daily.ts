import "server-only";

import { fetchSearch } from "./itunes-search";
import { fetchReviews } from "./itunes-reviews";
import { fetchAppleHints, fetchAppleTrending, fetchPlaySuggest } from "./suggest";
import { step, values, outcomes, skipped, type StepResult } from "./run-step";
import { KEYWORDS, EDUCATION_GENRE, PLAY_EDUCATION_CATEGORY } from "./config";
import {
  ACTIVE_SLUMP_SHARE,
  ACTIVE_SURGE_SHARE,
  REVENUE_SLUMP_SHARE,
  REVENUE_SURGE_SHARE,
  checkDownloadSlump,
  checkDownloadSurge,
  checkFollowerMove,
  checkRankDrop,
  checkRankImprovement,
  checkRatingDrop,
  checkRatingRise,
  checkSeriesMove,
  completeDays,
  notifyMetricAnomalies,
  type Movement,
} from "./metric-alerts";
import {
  dauSeries,
  followerDayEnds,
  iosDailyDownloads,
  rankHistory,
  revenueSummary,
  snapshotHistory,
} from "@/lib/db/queries";
import { explainMovements, movementKey } from "@/lib/analyst/explain";
import { METRIC_LABELS, SOCIAL_PLATFORM_KEYS } from "@/lib/metric-keys";
import { localDate } from "@/lib/growth";
import {
  fetchInstagramDemographics,
  fetchInstagramPosts,
  fetchInstagramSeries,
  fetchInstagramTotals,
  isoDate,
  recentPosts,
  startOfUtcDay,
} from "./instagram";
import {
  hourBucket,
  recordRuns,
  saveInstagramDemographics,
  saveInstagramNewFollowers,
  saveInstagramPostMetrics,
  saveInstagramPosts,
  saveInstagramReach,
  saveInstagramTotals,
  saveKeywordRanks,
  saveReviews,
  saveSuggestions,
  type SuggestionBatch,
} from "@/lib/db/persist";
import { analyticsRequestId, ascEnv, ascConfigProblem } from "@/lib/env";
import {
  ESCALATE_WHEN_DAYS_LEFT,
  daysUntilExpiry,
  instagramToken,
  refreshInstagramToken,
} from "@/lib/db/tokens";
import type { KeywordRank, Review } from "./types";

/**
 * The daily run: keyword positions, review sync, and the iOS download pull.
 *
 * Keywords and reviews only need daily resolution. The iOS download step is the
 * reason this runs in the morning: App Store Connect closes a day and publishes
 * it the next, so there is nothing new to fetch until then.
 */

export interface DailySummary {
  capturedAt: string;
  keywords: number;
  newReviews: number;
  iosDownloadsAvailable: boolean;
  failures: string[];
}

export async function runDaily(): Promise<DailySummary> {
  const capturedAt = hourBucket();

  // Sequential rather than parallel: nine near-identical search requests fired
  // at once is the shape Apple rate-limits.
  const keywordSteps: StepResult<KeywordRank>[] = [];
  for (const keyword of KEYWORDS) {
    keywordSteps.push(
      await step(`itunes-search:uz:${keyword}`, () => fetchSearch(keyword, "uz")),
    );
  }

  const reviewStep = await step("itunes-reviews:uz", () => fetchReviews("uz"));

  /*
   * Search suggestions per tracked keyword, both stores, plus Apple's
   * trending list. Sequential like the searches above and for the same
   * reason. One step per store per seed so a single dead endpoint is one red
   * badge, not a lost crawl.
   */
  const suggestionSteps: StepResult<SuggestionBatch>[] = [];
  for (const keyword of KEYWORDS) {
    suggestionSteps.push(
      await step(`suggest:ios:${keyword}`, async () => ({
        platform: "ios" as const,
        seed: keyword,
        terms: await fetchAppleHints(keyword),
      })),
    );
    suggestionSteps.push(
      await step(`suggest:play:${keyword}`, async () => ({
        platform: "android" as const,
        seed: keyword,
        terms: await fetchPlaySuggest(keyword),
      })),
    );
  }
  suggestionSteps.push(
    await step("suggest:ios:__trending__", async () => ({
      platform: "ios" as const,
      seed: "__trending__",
      terms: await fetchAppleTrending(),
    })),
  );

  const asc = ascEnv();
  const iosDownloadStep: StepResult<unknown> = asc
    ? await step("asc-sales", async () => {
        const { collectIosDownloads } = await import("@/lib/asc/collect");
        return collectIosDownloads(asc);
      })
    : skipped("asc-sales", ascConfigProblem() ?? "App Store Connect is not configured");

  /*
   * Source attribution: which downloads came from search, browse or a
   * referral. Separate from asc-sales because it has its own latency and can
   * legitimately have nothing to return for a day or two after the ongoing
   * request is created, which is a skip rather than a failure.
   */
  const analyticsRequest = analyticsRequestId();
  const analyticsStep: StepResult<unknown> =
    asc && analyticsRequest
      ? await step("asc-analytics", async () => {
          const { collectIosAnalytics } = await import("@/lib/asc/collect-analytics");
          return collectIosAnalytics(asc, analyticsRequest);
        })
      : skipped(
          "asc-analytics",
          asc ? "no analytics request id configured" : "App Store Connect is not configured",
        );

  /*
   * The top of the same funnel: impressions and product page views.
   *
   * Its own step rather than part of asc-analytics because it is a separate
   * report that can be missing, restated or broken independently, and because
   * its parser was written against Apple's documented columns rather than an
   * observed payload. If those disagree, this step should fail on its own and
   * say so while the download breakdown keeps working.
   */
  const discoveryStep: StepResult<unknown> =
    asc && analyticsRequest
      ? await step("asc-discovery", async () => {
          const { collectIosDiscovery } = await import("@/lib/asc/collect-discovery");
          return collectIosDiscovery(asc, analyticsRequest);
        })
      : skipped(
          "asc-discovery",
          asc ? "no analytics request id configured" : "App Store Connect is not configured",
        );

  /*
   * Keep the Instagram credential alive.
   *
   * Runs daily but only acts inside the refresh window, so ordinarily this is
   * a no-op. It matters because a token that misses its 60-day window expires
   * permanently and needs a human to sign in again; refreshing at 30 days
   * leaves a month of slack for the cron itself to be broken.
   */
  const tokenStep = await step("instagram-token", async () => {
    const token = await instagramToken();
    if (!token) return "no token configured";

    const remaining = daysUntilExpiry(token);
    try {
      const refreshed = await refreshInstagramToken(token);
      return refreshed
        ? "refreshed for another 60 days"
        : `no refresh needed, ${Math.round(remaining)} days left`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Inside the escalation window a failed refresh is not routine: past
      // expiry the only fix is manual reauthorisation.
      if (remaining < ESCALATE_WHEN_DAYS_LEFT) {
        throw new Error(
          `token expires in ${Math.round(remaining)} days and refresh failed, ` +
            `reauthorise Instagram: ${message}`,
        );
      }
      throw new Error(message);
    }
  });

  /*
   * Instagram insights: the account's own performance, its posts, and who is
   * following it.
   *
   * Gated on the token rather than on SOCIAL_INSTAGRAM_HANDLE, unlike the
   * follower counter in run-poll. These endpoints all address /me, so the
   * account is whichever one authorised the credential; a handle would be
   * decoration that could disagree with reality.
   */
  const igToken = await instagramToken();
  const today = isoDate(startOfUtcDay(new Date()));

  const instagramDailyStep = igToken
    ? await step("instagram:daily", async () => {
        /*
         * Three days rather than just yesterday. A run that failed or was
         * skipped leaves a hole, and re-reading the window costs the same one
         * request as reading a single day, so the gap heals itself.
         */
        const until = startOfUtcDay(new Date());
        const since = new Date(until.getTime() - 3 * 86_400_000);
        const yesterday = new Date(until.getTime() - 86_400_000);

        const [reach, newFollowers, totals] = await Promise.all([
          fetchInstagramSeries(igToken.accessToken, "reach", since, until),
          fetchInstagramSeries(igToken.accessToken, "follower_count", since, until),
          fetchInstagramTotals(igToken.accessToken, yesterday),
        ]);
        return { reach, newFollowers, totals };
      })
    : skipped("instagram:daily", "no token configured");

  const instagramPostsStep = igToken
    ? await step("instagram:posts", () => fetchInstagramPosts(igToken.accessToken))
    : skipped("instagram:posts", "no token configured");

  const instagramDemographicsStep = igToken
    ? await step("instagram:demographics", () => fetchInstagramDemographics(igToken.accessToken))
    : skipped("instagram:demographics", "no token configured");

  const keywordRanks = values(keywordSteps);
  const reviews: Review[] = reviewStep.value ?? [];

  const instagramDaily = instagramDailyStep.value;
  const instagramPosts = instagramPostsStep.value ?? [];
  const instagramDemographics = instagramDemographicsStep.value ?? [];

  const writes = await Promise.allSettled([
    saveKeywordRanks(keywordRanks, capturedAt),
    saveReviews(reviews),
    saveSuggestions(values(suggestionSteps), capturedAt),
    instagramDaily
      ? Promise.all([
          saveInstagramReach(instagramDaily.reach),
          saveInstagramNewFollowers(instagramDaily.newFollowers),
          saveInstagramTotals([instagramDaily.totals]),
        ]).then((counts) => counts.reduce((sum, n) => sum + n, 0))
      : Promise.resolve(0),
    // Sequential on purpose: instagram_post_metrics references
    // instagram_posts, so a post first seen today has no parent row until the
    // posts write lands.
    (async () => {
      const saved = await saveInstagramPosts(instagramPosts);
      await saveInstagramPostMetrics(recentPosts(instagramPosts), today);
      return saved;
    })(),
    saveInstagramDemographics(instagramDemographics, today),
  ]);

  const newReviews =
    writes[1].status === "fulfilled" ? (writes[1].value as number) : 0;

  // Success is recorded too, so a single bad run does not leave the health
  // panel showing a permanent failure. See the note in run-poll.ts.
  const writeLabels = [
    "persist:keyword_ranks",
    "persist:reviews",
    "persist:suggestions",
    "persist:instagram_daily",
    "persist:instagram_posts",
    "persist:instagram_demographics",
  ];
  const writeOutcomes = writes.map((result, index) =>
    result.status === "rejected"
      ? {
          source: writeLabels[index],
          status: "failed" as const,
          error: String(result.reason),
        }
      : {
          source: writeLabels[index],
          status: "ok" as const,
          records: typeof result.value === "number" ? result.value : 0,
        },
  );

  const all = [
    ...outcomes([
      ...keywordSteps,
      reviewStep,
      ...suggestionSteps,
      iosDownloadStep,
      analyticsStep,
      discoveryStep,
      tokenStep,
      instagramDailyStep,
      instagramPostsStep,
      instagramDemographicsStep,
    ]),
    ...writeOutcomes,
  ];
  await recordRuns(all);

  // After the writes, so the rules read the figures this run just recorded
  // rather than yesterday’s. Never throws; see notifyMetricAnomalies.
  await checkMetrics();

  return {
    capturedAt,
    keywords: keywordRanks.length,
    newReviews,
    iosDownloadsAvailable: asc !== null,
    failures: all
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) => `${outcome.source}: ${outcome.error}`),
  };
}

/**
 * Did any headline figure move enough to be worth a message?
 *
 * Reads rather than collects, which is why it sits at the end of the run and
 * outside the step machinery: a rule failing to evaluate is not a collector
 * outage and should not appear in the health panel as one. Anything that goes
 * wrong here is swallowed, because a daily collection must not fail on account
 * of an alert it was only trying to send as a courtesy.
 *
 * The day-over-day windows are one day, because those rules compare today
 * against yesterday, and each query returns its window oldest first, so the
 * ends of the array are the two readings a rule wants. The median rules take
 * three weeks, which is a fortnight of history plus the day being judged.
 *
 * Ratings come from snapshotHistory rather than ratingTrend for that reason:
 * ratingTrend compares against roughly a week ago, which would keep finding
 * the same drop every day for the six days after it happened.
 *
 * The order the movements are listed in is their priority, because the
 * explainer only writes about the first few. Chart position leads: it is the
 * figure that moves for reasons somebody can act on. Followers come last,
 * being the slowest to move and the least surprising when they do.
 */
async function checkMetrics(): Promise<void> {
  try {
    const [appleRanks, playRanks, downloads, iosRatings, androidRatings, revenue, dau, social] =
      await Promise.all([
        rankHistory("topfree", "uz", EDUCATION_GENRE, 1, "ios"),
        rankHistory("topfree", "uz", PLAY_EDUCATION_CATEGORY, 1, "android"),
        iosDailyDownloads(21),
        snapshotHistory("ios", "uz", 1),
        snapshotHistory("android", "uz", 1),
        revenueSummary(21),
        dauSeries(21),
        followerDayEnds(3),
      ]);

    const ends = <T,>(rows: T[]): [T | null, T | null] => [
      rows[0] ?? null,
      rows.length > 1 ? rows[rows.length - 1] : null,
    ];

    const [appleThen, appleNow] = ends(appleRanks);
    const [playThen, playNow] = ends(playRanks);
    const [iosThen, iosNow] = ends(iosRatings);
    const [androidThen, androidNow] = ends(androidRatings);

    // The day these readings describe. The series rules date themselves from
    // their own newest row, which may be older when a feed is behind.
    const today = localDate(new Date().toISOString());

    const APPLE = { key: "education_rank_ios", label: "Education, App Store" } as const;
    const PLAY = { key: "education_rank_android", label: "Education, Google Play" } as const;
    const IOS_DOWNLOADS = { key: "ios_downloads", label: "App Store downloads" } as const;
    const IOS_RATING = { key: "ios_rating", label: "App Store rating" } as const;
    const PLAY_RATING = { key: "android_rating", label: "Google Play rating" } as const;
    const REVENUE = { key: "revenue", label: "Takings" } as const;
    const ACTIVE = { key: "active_users", label: "Daily active" } as const;

    /*
     * Today is excluded from every series. It is still being counted, and a
     * part-day measured against a fortnight of whole ones reports a collapse
     * every morning. See completeDays.
     */
    const downloadDays = completeDays(
      downloads.map((day) => ({ date: day.date, downloads: day.downloads })),
      today,
    );
    const revenueDays = completeDays(
      revenue.daily.map((day) => ({ date: day.date, value: day.amount })),
      today,
    );
    const activeDays = completeDays(dau, today);

    const movements = [
      checkRankDrop(APPLE, today, appleNow?.rank ?? null, appleThen?.rank ?? null, appleNow?.feedSize ?? null),
      checkRankImprovement(APPLE, today, appleNow?.rank ?? null, appleThen?.rank ?? null, appleNow?.feedSize ?? null),
      checkRankDrop(PLAY, today, playNow?.rank ?? null, playThen?.rank ?? null, playNow?.feedSize ?? null),
      checkRankImprovement(PLAY, today, playNow?.rank ?? null, playThen?.rank ?? null, playNow?.feedSize ?? null),

      checkDownloadSlump(IOS_DOWNLOADS, downloadDays),
      checkDownloadSurge(IOS_DOWNLOADS, downloadDays),

      checkSeriesMove(REVENUE, revenueDays, {
        slumpShare: REVENUE_SLUMP_SHARE,
        surgeShare: REVENUE_SURGE_SHARE,
        unit: "UZS",
      }),
      checkSeriesMove(ACTIVE, activeDays, {
        slumpShare: ACTIVE_SLUMP_SHARE,
        surgeShare: ACTIVE_SURGE_SHARE,
      }),

      checkRatingDrop(IOS_RATING, today, iosNow?.rating ?? null, iosThen?.rating ?? null),
      checkRatingRise(IOS_RATING, today, iosNow?.rating ?? null, iosThen?.rating ?? null),
      checkRatingDrop(PLAY_RATING, today, androidNow?.rating ?? null, androidThen?.rating ?? null),
      checkRatingRise(PLAY_RATING, today, androidNow?.rating ?? null, androidThen?.rating ?? null),

      ...Object.entries(SOCIAL_PLATFORM_KEYS).map(([platform, key]) => {
        // The last two days we have readings for, which are not necessarily
        // yesterday and today: a platform that stopped answering leaves gaps,
        // and comparing across one is better than inventing a zero for it.
        const days = social.get(platform) ?? [];
        const now = days[days.length - 1];
        const before = days[days.length - 2];

        return checkFollowerMove(
          { key, label: METRIC_LABELS[key] },
          now?.date ?? today,
          now?.followers ?? null,
          before?.followers ?? null,
        );
      }),
    ].filter((movement): movement is Movement => movement !== null);

    /*
     * Explained before the alert rather than after it, so the message can carry
     * the note. The cost is that a quiet Telegram waits on a model call; the
     * alternative is two messages for one piece of news, and the second one
     * arriving without the first one's context.
     *
     * Never throws and returns whatever it managed, so a model outage costs the
     * explanations and not the alert.
     */
    const notes = await explainMovements(movements);

    await notifyMetricAnomalies(
      movements.map((movement) => ({
        ...movement,
        noteUz: notes.get(movementKey(movement)),
      })),
    );
  } catch (error) {
    console.error("could not check metric anomalies:", error);
  }
}
