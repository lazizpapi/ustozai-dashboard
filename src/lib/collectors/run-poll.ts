import "server-only";

import { fetchLookupPayload, parseLookup } from "./itunes-lookup";
import { fetchChartPayload, parseChartMany, parseChartTop } from "./itunes-charts";
import { fetchReviews } from "./itunes-reviews";
import { fetchPlayPage, parsePlayDetails } from "./play-details";
import { fetchPlayReviews } from "./play-reviews";
import { parseIosListing, parsePlayListing, type ListingRecord } from "./listing";
import {
  fetchInstagramFollowers,
  fetchInstagramViaApi,
  fetchTelegramMembers,
  fetchYoutubeSubscribers,
  type SocialSnapshot,
} from "./social";
import { fetchInstagramStories } from "./instagram";
import { fetchPlayChart, parsePlayChart } from "./play-charts";
import { notifyStatusChanges } from "./alerts";
import { step, values, outcomes, skipped, type StepResult } from "./run-step";
import { collectorHealth } from "@/lib/db/queries";
import { collectUstozMetrics } from "@/lib/ustoz/collect";
import {
  CHART_COUNTRIES,
  CHART_TYPES,
  COMPETITORS,
  COUNTRIES,
  IOS_APP_ID,
  PLAY_CHART_TYPES,
  PLAY_REVIEW_LANGS,
} from "./config";
import {
  hourBucket,
  recordRuns,
  saveChartApps,
  saveChartRanks,
  saveListings,
  saveReviews,
  saveSnapshots,
  saveInstagramStories,
  saveSocialSnapshots,
  type RunOutcome,
} from "@/lib/db/persist";
import { socialEnv } from "@/lib/env";
import { instagramToken } from "@/lib/db/tokens";
import type { ChartApp, ChartRank, MetricSnapshot, Review } from "./types";

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
  /** Rows written from UstozAI's own admin API, zero when it is unconfigured. */
  ustozActiveUsers: number;
  ustozRevenueRows: number;
  failures: string[];
}

/**
 * One store page read for two purposes: the metric snapshot, and the listing
 * fields whose changes the market page tracks. Bundled so each source is
 * fetched exactly once per poll.
 */
interface StoreReading {
  snapshot: MetricSnapshot | null;
  listing: ListingRecord | null;
}

async function readIosStore(country: string, appId?: string): Promise<StoreReading> {
  const payload = await fetchLookupPayload(country, appId);
  return {
    snapshot: parseLookup(payload, country, appId),
    // Listings are watched in the storefront that matters. The other
    // storefronts sell the same metadata, so tracking them would only
    // triple-report every change.
    listing: country === "uz" ? parseIosListing(payload, appId) : null,
  };
}

async function readPlayStore(country: string, packageName?: string): Promise<StoreReading> {
  const html = await fetchPlayPage(country, packageName);
  return {
    snapshot: parsePlayDetails(html, country, packageName),
    listing: parsePlayListing(html, packageName),
  };
}

export async function runPoll(): Promise<PollSummary> {
  const capturedAt = hourBucket();

  const lookupSteps = await Promise.all(
    COUNTRIES.map((country) =>
      step(`itunes-lookup:${country}`, () => readIosStore(country)),
    ),
  );

  /*
   * Every tracked app's rank comes out of the same four feeds we already pull.
   * A chart payload is the same hundred entries whoever is asking, so adding
   * competitors here costs parsing and not a single extra request. The same
   * payload also yields the visible top of the chart for the market page.
   */
  const trackedIosIds = [
    IOS_APP_ID,
    ...COMPETITORS.flatMap((c) => (c.iosId ? [c.iosId] : [])),
  ];

  const chartSteps = await Promise.all(
    CHART_COUNTRIES.flatMap((country) =>
      CHART_TYPES.map((chart) =>
        step(`itunes-charts:${country}:${chart.key}:${chart.genre}`, async () => {
          const query = {
            country,
            feed: chart.feed,
            genre: chart.genre,
            chartType: chart.key,
          };
          const payload = await fetchChartPayload(query);
          return {
            ranks: parseChartMany(payload, query, trackedIosIds),
            top: parseChartTop(payload, query),
          };
        }),
      ),
    ),
  );

  /*
   * The same question asked of the other store.
   *
   * Sequential rather than raced, following the etiquette note in
   * docs/competitor-data-collection.md: near-identical requests arriving at one
   * endpoint in the same instant is the shape that gets rate limited. Two
   * charts, so two requests an hour.
   *
   * Only our own app is read from these. Apple's feed is parsed for every
   * tracked competitor because the payload is the same hundred entries whoever
   * is asking; the same is true here, and adding competitors later costs
   * parsing rather than requests.
   */
  const playChartSteps: ChartRank[] = [];
  const playChartOutcomes: RunOutcome[] = [];
  for (const country of CHART_COUNTRIES) {
    for (const chart of PLAY_CHART_TYPES) {
      const result = await step(
        `play-charts:${country}:${chart.key}:${chart.genre}`,
        async () => {
          const query = {
            country,
            collection: chart.collection,
            category: chart.category,
            genre: chart.genre,
            chartType: chart.key,
          };
          return parsePlayChart(await fetchPlayChart(query), query);
        },
      );
      playChartOutcomes.push(result.outcome);
      if (result.value) playChartSteps.push(result.value);
    }
  }

  const playStep = await step("play-details:uz", () => readPlayStore("uz"));

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
  const competitorSteps: StepResult<StoreReading>[] = [];
  for (const competitor of COMPETITORS) {
    if (competitor.iosId) {
      competitorSteps.push(
        await step(`competitor:lookup:${competitor.slug}`, () =>
          readIosStore("uz", competitor.iosId!),
        ),
      );
    }
    if (competitor.androidPackage) {
      competitorSteps.push(
        await step(`competitor:play:${competitor.slug}`, () =>
          readPlayStore("uz", competitor.androidPackage!),
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

  /*
   * Stories, which are the one thing here that cannot be collected late.
   *
   * Instagram drops a story from the API twenty-four hours after it is posted,
   * so a story missed is a story lost rather than merely delayed. Hourly is
   * the cheapest schedule that cannot miss one, and an empty list is the
   * normal answer for most hours rather than a failure.
   *
   * It lives in the hourly poll rather than the five-minute pulse because
   * pulse.test.ts asserts the retry budget fits inside a thirty second
   * function, and this is a request that can itself fan out.
   */
  const instagramTokenRow = await instagramToken();
  const storiesStep = instagramTokenRow
    ? await step("instagram:stories", () =>
        fetchInstagramStories(instagramTokenRow.accessToken),
      )
    : skipped("instagram:stories", "no token configured");

  const allSteps: StepResult<unknown>[] = [
    ...lookupSteps,
    ...chartSteps,
    playStep,
    reviewStep,
    ...playReviewSteps,
    ...competitorSteps,
    ...socialSteps,
    storiesStep,
  ];

  // parseLookup returns a null snapshot for storefronts that do not carry the
  // app, which is an ordinary answer rather than something to store.
  const readings: StoreReading[] = [
    ...values(lookupSteps),
    ...values([playStep]),
    ...values(competitorSteps),
  ];
  const snapshots: MetricSnapshot[] = readings.flatMap((reading) =>
    reading.snapshot ? [reading.snapshot] : [],
  );
  const listings: ListingRecord[] = readings.flatMap((reading) =>
    reading.listing ? [reading.listing] : [],
  );

  // One write for both stores. saveChartRanks resolves app_id from each rank's
  // own platform, so Apple and Play rows differ only in which app they point at.
  const ranks: ChartRank[] = [
    ...values(chartSteps).flatMap((chart) => chart.ranks),
    ...playChartSteps,
  ];
  const chartTops: ChartApp[] = values(chartSteps).flatMap((chart) => chart.top);

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
    saveChartApps(chartTops, capturedAt),
    saveListings(listings),
    saveReviews(allReviews),
    saveSocialSnapshots(socialSnapshots, capturedAt),
    saveInstagramStories(storiesStep.value ?? []),
  ]);

  const writeLabels = [
    "persist:snapshots",
    "persist:chart_ranks",
    "persist:chart_apps",
    "persist:listings",
    "persist:reviews",
    "persist:social",
    "persist:instagram_stories",
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

  /*
   * UstozAI's own metrics ride the hourly poll rather than getting their own
   * schedule. Revenue and active users move through the day, and the API
   * accepts a date range, so each run re-reads the last week and repairs any
   * day an earlier failure left behind.
   *
   * It runs after the store collectors and persists itself, so a broken admin
   * API cannot cost us a rank reading.
   */
  const ustoz = await collectUstozMetrics();

  const all = [
    ...outcomes(allSteps),
    ...playChartOutcomes,
    ...writeOutcomes,
    ...ustoz.outcomes,
  ];

  /*
   * Read the old health before writing the new, because collectorHealth
   * returns the most recent row per source and after recordRuns that row is
   * this run rather than the one being compared against.
   *
   * The alert rides the hourly poll rather than the daily run: the daily run
   * is itself a thing that can stop, and an alarm wired into the machine it is
   * meant to watch is not an alarm.
   */
  const before = await collectorHealth();
  await recordRuns(all);
  await notifyStatusChanges(before, all);

  return {
    capturedAt,
    snapshots: snapshots.length,
    ranks: ranks.length,
    social: socialSnapshots.length,
    ustozActiveUsers: ustoz.activeUsers,
    ustozRevenueRows: ustoz.revenueRows,
    failures: all
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) => `${outcome.source}: ${outcome.error}`),
  };
}
