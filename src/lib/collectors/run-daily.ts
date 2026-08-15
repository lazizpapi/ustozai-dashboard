import "server-only";

import { fetchSearch } from "./itunes-search";
import { fetchReviews } from "./itunes-reviews";
import { fetchAppleHints, fetchAppleTrending, fetchPlaySuggest } from "./suggest";
import { step, values, outcomes, skipped, type StepResult } from "./run-step";
import { KEYWORDS } from "./config";
import {
  hourBucket,
  recordRuns,
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

  const keywordRanks = values(keywordSteps);
  const reviews: Review[] = reviewStep.value ?? [];

  const writes = await Promise.allSettled([
    saveKeywordRanks(keywordRanks, capturedAt),
    saveReviews(reviews),
    saveSuggestions(values(suggestionSteps), capturedAt),
  ]);

  const newReviews =
    writes[1].status === "fulfilled" ? (writes[1].value as number) : 0;

  // Success is recorded too, so a single bad run does not leave the health
  // panel showing a permanent failure. See the note in run-poll.ts.
  const writeLabels = ["persist:keyword_ranks", "persist:reviews", "persist:suggestions"];
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
