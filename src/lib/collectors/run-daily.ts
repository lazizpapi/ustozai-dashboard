import "server-only";

import { fetchSearch } from "./itunes-search";
import { fetchReviews } from "./itunes-reviews";
import { fetchAppleHints, fetchAppleTrending, fetchPlaySuggest } from "./suggest";
import { step, values, outcomes, skipped, type StepResult } from "./run-step";
import { KEYWORDS } from "./config";
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
