import "server-only";

import { fetchLookup } from "./itunes-lookup";
import { fetchChartMany } from "./itunes-charts";
import { fetchReviews } from "./itunes-reviews";
import { fetchPlayDetails } from "./play-details";
import { fetchPlayReviews } from "./play-reviews";
import {
  fetchInstagramFollowers,
  fetchInstagramViaApi,
  fetchTelegramMembers,
  fetchYoutubeSubscribers,
  type SocialSnapshot,
} from "./social";
import { step, values, outcomes, skipped, type StepResult } from "./run-step";
import {
  CHART_COUNTRIES,
  CHART_TYPES,
  COMPETITORS,
  COUNTRIES,
  IOS_APP_ID,
  PLAY_REVIEW_LANGS,
} from "./config";
import {
  hourBucket,
  recordRuns,
  saveChartRanks,
  saveReviews,
  saveSnapshots,
  saveSocialSnapshots,
} from "@/lib/db/persist";
import { socialEnv } from "@/lib/env";
import { instagramToken } from "@/lib/db/tokens";
import type { ChartRank, MetricSnapshot, Review } from "./types";

/**
 * The frequent poll: chart position, rating, and Play installs.
 *
 * Runs every few hours. Anything faster is wasted, because Apple refreshes its
 * charts only a handful of times a day and Play's cumulative install count
 * moves slowly by construction.
 */

export interface PollSummary {
  capturedAt: string;
  snapshots: number;
  ranks: number;
  social: number;
  failures: string[];
}

export async function runPoll(): Promise<PollSummary> {
  const capturedAt = hourBucket();

  const lookupSteps = await Promise.all(
    COUNTRIES.map((country) =>
      step(`itunes-lookup:${country}`, () => fetchLookup(country)),
    ),
  );

  /*
   * Every tracked app's rank comes out of the same four feeds we already pull.
   * A chart payload is the same hundred entries whoever is asking, so adding
   * competitors here costs parsing and not a single extra request.
   */
  const trackedIosIds = [
    IOS_APP_ID,
    ...COMPETITORS.flatMap((c) => (c.iosId ? [c.iosId] : [])),
  ];

  const chartSteps = await Promise.all(
    CHART_COUNTRIES.flatMap((country) =>
      CHART_TYPES.map((chart) =>
        step(`itunes-charts:${country}:${chart.key}:${chart.genre}`, () =>
          fetchChartMany(
            {
              country,
              feed: chart.feed,
              genre: chart.genre,
              chartType: chart.key,
            },
            trackedIosIds,
          ),
        ),
      ),
    ),
  );

  const playStep = await step("play-details:uz", () => fetchPlayDetails("uz"));

  /*
   * Reviews are collected here as well as in the daily run.
   *
   * Apple's reviews feed goes down for stretches: during the first live run it
   * returned empty for every app tested, WhatsApp included, so a whole-feed
   * outage rather than anything specific to us. Fetching once a day means one
   * attempt against a source that is sometimes unavailable for hours, and a
   * missed day is a permanent hole in the review record.
   *
   * Reviews are insert-only and deduplicated on the store's own id, so running
   * this eight times a day costs one extra request per poll and cannot produce
   * duplicates. It simply raises the odds of catching the feed alive.
   */
  const reviewStep = await step("itunes-reviews:uz:poll", () => fetchReviews("uz"));

  /*
   * Google Play reviews, one step per language.
   *
   * Sequential rather than parallel for the same reason as the keyword
   * searches: two near-identical requests to the same Play endpoint at the
   * same instant is the shape that gets rate limited. Deduplication happens in
   * the database on Play's own review id, so the overlap between languages
   * costs nothing.
   */
  const playReviewSteps: StepResult<Review[]>[] = [];
  for (const lang of PLAY_REVIEW_LANGS) {
    playReviewSteps.push(
      await step(`play-reviews:${lang}`, () => fetchPlayReviews(lang)),
    );
  }

  /*
   * Competitor store readings, UZ only and one step each so a single dead
   * listing is one red badge rather than a failed poll.
   *
   * Sequential for the same reason as the keyword searches: several
   * near-identical requests to one endpoint at the same instant is the shape
   * that gets rate limited. Ours are fetched first, above, so a competitor
   * being slow can never delay our own numbers.
   */
  const competitorSteps: StepResult<MetricSnapshot | null>[] = [];
  for (const competitor of COMPETITORS) {
    if (competitor.iosId) {
      competitorSteps.push(
        await step(`competitor:lookup:${competitor.slug}`, () =>
          fetchLookup("uz", competitor.iosId!),
        ),
      );
    }
    if (competitor.androidPackage) {
      competitorSteps.push(
        await step(`competitor:play:${competitor.slug}`, () =>
          fetchPlayDetails("uz", competitor.androidPackage!),
        ),
      );
    }
  }

  /*
   * Audience counts, one step per platform so a block on one never costs the
   * others. Each is independently configurable and an unset handle is skipped
   * rather than failed.
   */
  const social = socialEnv();
  const socialSteps: StepResult<SocialSnapshot>[] = [
    social.telegram
      ? await step("social:telegram", () =>
          fetchTelegramMembers(social.telegram!.channel, social.telegram!.botToken),
        )
      : skipped("social:telegram", "no channel configured"),
    social.instagram
      ? await step("social:instagram", async () => {
          /*
           * Prefer the official API when a credential exists. The scrape is
           * kept as the fallback because it still works when the collector is
           * run from a residential connection, which is exactly the situation
           * where someone is debugging without a token to hand.
           */
          const token = await instagramToken();
          return token
            ? fetchInstagramViaApi(token.accessToken, social.instagram!.handle)
            : fetchInstagramFollowers(social.instagram!.handle);
        })
      : skipped("social:instagram", "no handle configured"),
    social.youtube
      ? await step("social:youtube", () =>
          fetchYoutubeSubscribers(social.youtube!.handle, social.youtube!.apiKey),
        )
      : skipped("social:youtube", "no handle configured"),
  ];

  const allSteps: StepResult<unknown>[] = [
    ...lookupSteps,
    ...chartSteps,
    playStep,
    reviewStep,
    ...playReviewSteps,
    ...competitorSteps,
    ...socialSteps,
  ];

  // fetchLookup returns null for storefronts that do not carry the app, which
  // is an ordinary answer rather than something to store.
  const snapshots: MetricSnapshot[] = [
    ...values(lookupSteps).filter((s): s is MetricSnapshot => s !== null),
    ...values([playStep]),
    ...values(competitorSteps).filter((s): s is MetricSnapshot => s !== null),
  ];
  const ranks: ChartRank[] = values(chartSteps).flat();

  const socialSnapshots = values(socialSteps);

  // Both stores land in one call: reviews are insert-only and deduplicated on
  // the store's own id, so the shape of the write is identical either way.
  const allReviews: Review[] = [
    ...(reviewStep.value ?? []),
    ...values(playReviewSteps).flat(),
  ];

  const writes = await Promise.allSettled([
    saveSnapshots(snapshots, capturedAt),
    saveChartRanks(ranks, capturedAt),
    saveReviews(allReviews),
    saveSocialSnapshots(socialSnapshots, capturedAt),
  ]);

  const writeLabels = [
    "persist:snapshots",
    "persist:chart_ranks",
    "persist:reviews",
    "persist:social",
  ];

  // Record success as well as failure. The health panel shows the most recent
  // run per source, so if a persist step only ever wrote a row when it broke,
  // one bad run would sit there looking broken forever while every later run
  // quietly succeeded.
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

  await recordRuns([...outcomes(allSteps), ...writeOutcomes]);

  return {
    capturedAt,
    snapshots: snapshots.length,
    ranks: ranks.length,
    social: socialSnapshots.length,
    failures: [...outcomes(allSteps), ...writeOutcomes]
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) => `${outcome.source}: ${outcome.error}`),
  };
}
