import "server-only";

import {
  androidDailyInstalls,
  collectorHealth,
  educationChartTop,
  growthSeries,
  iosDailyDownloads,
  iosDiscoveryFunnel,
  keywordSuggestionSets,
  latestAnalystReport,
  latestKeywordRanks,
  marketOverview,
  noteHistory,
  recentListingChanges,
  recentReviews,
  activeUsersTrend,
  engagementSummary,
  instagramPerformance,
  instagramTopPosts,
  revenueSummary,
  socialTrends,
  type GrowthSeriesKey,
} from "@/lib/db/queries";
import { saveAgentFact } from "@/lib/db/persist";
import { isMetricKey, visibleKeys } from "@/lib/metric-keys";
import type { Period } from "@/lib/growth";

/**
 * Run one tool. The only place a tool name becomes a query, and the only place
 * one becomes a write.
 *
 * Lives apart from the chat loop because there are now two loops: the chat, and
 * the explainer that writes a note about a movement. Both give the model the
 * same tools and both have to reach the same data, and a second copy of this
 * switch would drift within a month of the first tool being added to it.
 *
 * Exactly one tool writes: remember_fact, which stores something the user has
 * asked to be remembered. It is reachable only when the caller passed it in
 * its tool list, and only the chat does that. The explainer runs unattended
 * over ASK_TOOLS and can never arrive here with that name.
 *
 * Unknown names return an error string rather than throwing: the model
 * occasionally hallucinates a plausible-sounding tool, and telling it so lets
 * it correct course on the next step instead of failing the whole question.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: { surface?: "telegram" | "chat" } = {},
): Promise<unknown> {
  switch (name) {
    case "get_downloads": {
      const days = args.days as number;
      const [ios, android] = await Promise.all([
        iosDailyDownloads(days),
        androidDailyInstalls(days),
      ]);
      return {
        appStore: ios,
        googlePlay: android,
        note:
          "Play figures are differenced from a cumulative counter Google updates " +
          "about once a day; a zero may mean the counter has not moved.",
      };
    }

    case "get_market":
      return marketOverview();

    case "get_chart":
      return educationChartTop();

    case "get_conversion_funnel": {
      const funnel = await iosDiscoveryFunnel(args.days as number);
      return funnel ?? { available: false, reason: "no discovery report data yet" };
    }

    case "get_keywords": {
      const [ranks, suggestions] = await Promise.all([
        latestKeywordRanks("uz"),
        keywordSuggestionSets(),
      ]);
      return { positions: ranks, suggestions };
    }

    case "get_reviews": {
      const reviews = await recentReviews(args.limit as number);
      const max = args.maxRating as number | undefined;
      return max === undefined ? reviews : reviews.filter((review) => review.rating <= max);
    }

    case "get_audience":
      return socialTrends();

    case "get_growth":
      return growthSeries(args.metric as GrowthSeriesKey, args.period as Period);

    case "get_listing_changes":
      return recentListingChanges(20);

    case "get_latest_report":
      return (await latestAnalystReport()) ?? { available: false };

    case "get_revenue":
      return revenueSummary(args.days as number);

    case "get_active_users": {
      const days = args.days as number;
      const [active, engagement] = await Promise.all([
        activeUsersTrend(),
        engagementSummary(days),
      ]);
      return {
        activeUsers: active,
        engagement,
        note:
          "Monthly active users are not collected: the upstream figure varies " +
          "with the window requested and is not a distinct-user count.",
      };
    }

    case "get_instagram": {
      const days = args.days as number;
      /*
       * Allowed to fail rather than taking the whole answer down, matching the
       * audience page. Without the insights tables or a token this is an
       * absence to report, not an error to raise.
       */
      try {
        const [performance, posts] = await Promise.all([
          instagramPerformance(days),
          instagramTopPosts(days, 10),
        ]);
        if (performance.daily.length === 0 && posts.length === 0) {
          return {
            available: false,
            reason:
              "nothing collected yet; Instagram insights need an access token, " +
              "and the follower count comes from a different source",
          };
        }
        return { performance, topPosts: posts };
      } catch {
        return { available: false, reason: "the Instagram insight tables are not present" };
      }
    }

    case "get_metric_notes": {
      /*
       * Deliberately unfiltered by role. Only two things reach this switch: the
       * dashboard chat, which /api/ask already refuses to anyone but the CEO,
       * and the Telegram group, which receives the takings in its daily alert
       * and can ask for them directly. Adding a role filter here would suggest
       * a third caller exists that has not been checked.
       */
      const metric = args.metric;
      return noteHistory(25, {
        keys: visibleKeys("ceo"),
        days: args.days as number,
        metricKey: isMetricKey(metric) ? metric : undefined,
      });
    }

    case "remember_fact": {
      const fact = typeof args.fact === "string" ? args.fact.trim() : "";
      // Reported back rather than thrown. The model needs to know the save did
      // not happen so it can say so, instead of confirming something that is
      // not there.
      if (fact.length === 0) return { saved: false, error: "nothing to remember" };

      await saveAgentFact(fact, context.surface ?? "chat");
      return { saved: true, fact };
    }

    case "get_collector_health":
      return collectorHealth();

    default:
      return { error: `no such tool: ${name}` };
  }
}
