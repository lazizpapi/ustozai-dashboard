import "server-only";

import type { PackInput } from "./pack";
import { localDate } from "@/lib/growth";
import {
  activeFacts,
  androidDailyInstalls,
  collectorHealth,
  educationChartTop,
  iosDailyDownloads,
  iosDiscoveryFunnel,
  keywordSuggestionSets,
  latestAnalystReport,
  latestKeywordRanks,
  marketOverview,
  recentListingChanges,
  recentReviews,
  socialTrends,
} from "@/lib/db/queries";

/**
 * Everything the analyst is allowed to know, read once.
 *
 * Deliberately reuses the same queries the pages render from, so the briefing
 * and the dashboard can never disagree: if the analyst says downloads fell,
 * the downloads page shows the same fall. A separate query path here would be
 * a second source of truth, and eventually a contradiction somebody has to
 * adjudicate at the worst possible moment.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function gatherPack(): Promise<PackInput> {
  const [
    ios,
    android,
    funnel,
    market,
    keywords,
    suggestions,
    listingChanges,
    reviews,
    audience,
    health,
    chart,
    facts,
    previous,
  ] = await Promise.all([
    iosDailyDownloads(21),
    androidDailyInstalls(21),
    iosDiscoveryFunnel(30),
    marketOverview(),
    latestKeywordRanks("uz"),
    keywordSuggestionSets(),
    recentListingChanges(15),
    recentReviews(60, new Date(Date.now() - 7 * DAY_MS).toISOString()),
    socialTrends(),
    collectorHealth(),
    educationChartTop(),
    activeFacts(),
    // What we told them last time, so today's report can say whether it
    // happened rather than starting the argument again from nothing.
    latestAnalystReport(),
  ]);

  const ratings = reviews.map((review) => review.rating);

  return {
    generatedAt: new Date().toISOString(),
    iosDownloads: ios.map((row) => ({ date: row.date, downloads: row.downloads })),
    androidInstalls: android.map((row) => ({ date: row.date, installs: row.installs })),
    funnel,
    market: market.map((app) => ({
      name: app.name,
      isOurs: app.isOurs,
      rank: app.rank,
      rankPrevious: app.rankPrevious,
      playInstalls: app.playInstalls,
      playInstallsPrevious: app.playInstallsPrevious,
      playRating: app.playRating,
      iosRating: app.iosRating,
    })),
    keywords: keywords.map((row) => ({
      keyword: row.keyword,
      position: row.position,
      previous: row.previous,
    })),
    // Only the newly appeared terms. The full suggestion list is the same
    // every day and would crowd out the part that is actually news.
    newSuggestions: suggestions.flatMap((set) =>
      set.terms
        .filter((term) => term.isNew)
        .map((term) => ({ store: set.platform, seed: set.seed, term: term.term })),
    ),
    listingChanges: listingChanges.map((change) => ({
      appName: change.appName,
      platform: change.platform,
      detectedAt: change.detectedAt,
      changedFields: change.changedFields,
    })),
    reviews: reviews.length
      ? {
          total: reviews.length,
          averageRating:
            Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100,
          // The lowest-rated recent reviews, because the complaint is the
          // actionable part; praise rarely changes what to do on Monday.
          worst: [...reviews]
            .sort((a, b) => a.rating - b.rating)
            .slice(0, 3)
            .map((review) => ({
              rating: review.rating,
              title: review.title,
              body: review.body,
              platform: review.platform,
            })),
        }
      : null,
    audience: audience.map((row) => ({
      platform: row.platform,
      current: row.current,
      previous: row.previous,
    })),
    health: health.map((source) => ({
      source: source.source,
      status: source.status,
      error: source.error,
    })),
    chartTop: chart.movers.slice(0, 10).map((mover) => ({
      rank: mover.rank,
      name: mover.name,
      vsWeek: mover.vsWeek,
    })),
    teamFacts: facts.map((entry) => entry.fact),
    previousRecommendations:
      previous?.report && previous.report.recommendations.length > 0
        ? {
            date: localDate(previous.createdAt),
            items: previous.report.recommendations.map((item) => ({
              action: item.action,
              expectedImpact: item.expectedImpact,
            })),
          }
        : null,
  };
}
