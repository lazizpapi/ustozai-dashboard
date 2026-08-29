import type OpenAI from "openai";

import { GROWTH_SERIES, type GrowthSeriesKey } from "@/lib/db/queries";
import { METRIC_KEYS, isMetricKey } from "@/lib/metric-keys";
import { PERIODS, type Period } from "@/lib/growth";

/**
 * What the chat agent is allowed to read.
 *
 * The model picks the tool and the arguments, so both are untrusted input.
 * Two rules make "let it read anything" safe rather than alarming:
 *
 * It never writes a query. Every tool maps to one existing, already
 * parameterised function from queries.ts — there is no path from a model
 * output to arbitrary SQL, and adding one would be the single worst change
 * anyone could make to this file.
 *
 * Every argument is clamped to a range the database can actually serve. A
 * model asking for a hundred thousand days is a plausible mistake, and it
 * should cost a bounded query rather than a timed-out page.
 *
 * `strict: false` throughout, deliberately. Strict mode requires every
 * property to be required, which would force the model to pass a day count on
 * every call and would turn get_reviews' genuinely optional rating filter into
 * a mandatory one ("all reviews" and "complaints only" are different
 * questions). clampArgs is the guarantee instead, and it is the thing the
 * tests pin.
 */

const DAYS = { min: 1, max: 365, fallback: 30 };
const LIMIT = { min: 1, max: 100, fallback: 25 };

function clampNumber(
  raw: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const daysSchema = (hint: string) => ({
  type: "object" as const,
  properties: {
    days: { type: "number", description: `${hint} Between 1 and 365. Defaults to 30.` },
  },
});

const noArgs = { type: "object" as const, properties: {} };

export const ASK_TOOLS: OpenAI.Responses.Tool[] = [
  {
    name: "get_downloads",
    description:
      "Daily App Store downloads and Google Play installs for Ustoz AI. Apple's " +
      "figures are its own reporting day and arrive a day or two late. Play " +
      "figures are differenced from Google's cumulative counter, which Google " +
      "updates about once a day, so a zero often means the counter has not " +
      "moved rather than that nobody installed. Use for any question about " +
      "how many people are installing the app over time.",
    type: "function",
    strict: false,
    parameters: daysSchema("How many days of history to return."),
  },
  {
    name: "get_market",
    description:
      "Us against the five tracked competitor education apps in Uzbekistan: " +
      "current Education chart rank, rank a week ago, Google Play install " +
      "totals and their weekly change, and both stores' ratings. Use for any " +
      "comparison question or 'how are we doing against X'.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_chart",
    description:
      "The visible top of the Uzbek Education chart (top free, iPhone) with " +
      "each app's movement since yesterday and since last week, including apps " +
      "we do not otherwise track. Use to answer who is above us, who is " +
      "climbing, and who newly entered.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_conversion_funnel",
    description:
      "Apple's discovery funnel for the App Store listing: impressions, taps, " +
      "product page views and first-time downloads, with the date range. This " +
      "is the top of the funnel and the only place to see how many people saw " +
      "the listing versus installed. App Store only; Google publishes no " +
      "equivalent.",
    type: "function",
    strict: false,
    parameters: daysSchema("How many days of funnel data to aggregate."),
  },
  {
    name: "get_keywords",
    description:
      "Current App Store search position for every tracked keyword, the " +
      "previous reading, and the store search-box suggestions for each term " +
      "with newly appeared ones flagged. Use for anything about search " +
      "visibility, ASO, or what people are typing.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_reviews",
    description:
      "Recent user reviews from both stores with rating, title, body and date. " +
      "Optionally filter to a maximum rating to read complaints only. Use for " +
      "questions about what users are saying, complaints, or sentiment.",
    type: "function",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many reviews. 1 to 100, default 25." },
        max_rating: {
          type: "number",
          description:
            "Only reviews at or below this star rating, 1 to 5. Omit for all reviews. " +
            "Set to 2 to read complaints.",
        },
      },
    },
  },
  {
    name: "get_audience",
    description:
      "Follower counts for the Telegram channel, Instagram and YouTube, with " +
      "the previous reading. YouTube is rounded by Google to three significant " +
      "figures, so small changes there are invisible rather than absent.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_growth",
    description:
      "Net change per period for one series: how much was gained or lost each " +
      "day, week, month or year. Use for trend and 'how fast are we growing' " +
      "questions rather than for current totals.",
    type: "function",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: Object.keys(GROWTH_SERIES),
          description: "Which series to bucket.",
        },
        period: { type: "string", enum: [...PERIODS], description: "Bucket size." },
      },
      required: ["metric", "period"],
    },
  },
  {
    name: "get_listing_changes",
    description:
      "Store listing edits across every tracked app, ours included: which app, " +
      "which store, when, and which fields changed (title, description, " +
      "screenshots, version). A competitor's edit is an ASO experiment being " +
      "run in public. Use to answer what competitors have changed recently.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_latest_report",
    description:
      "The most recent daily analyst report: its headline, health, findings and " +
      "recommendations. Use when asked about the last report or to avoid " +
      "contradicting a conclusion already published to the team.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
  {
    name: "get_revenue",
    description:
      "Money taken through the app, in som: the day total, the window total, " +
      "the split across payment providers (Payme, Click) and the transaction " +
      "counts. This is the company's own revenue, not App Store or Google Play " +
      "proceeds, which are separate and near zero because the app is a free " +
      "download. Use for any question about takings, payments or providers.",
    type: "function",
    strict: false,
    parameters: daysSchema("How many days of takings to aggregate."),
  },
  {
    name: "get_active_users",
    description:
      "How many people actually use the app, from the product's own API rather " +
      "than the stores: daily active users, plus views, logins and average " +
      "session length. Monthly active users are deliberately absent, because " +
      "the upstream figure changes with the window it is asked over and is not " +
      "a distinct-user count. Use for engagement and retention questions.",
    type: "function",
    strict: false,
    parameters: daysSchema("How many days of engagement history to return."),
  },
  {
    name: "get_instagram",
    description:
      "Instagram beyond the follower count: daily reach and views, new follows, " +
      "and the best performing recent posts with their reach, saves and " +
      "engagement. Reach is a unique count and does not add up across days, so " +
      "never sum it for a week. Returns empty when no access token is " +
      "configured, which is not the same as the account having no activity.",
    type: "function",
    strict: false,
    parameters: daysSchema("How many days of Instagram history to return."),
  },
  {
    name: "get_metric_notes",
    description:
      "Notes already written about metrics that moved notably, each with the " +
      "day, the direction, the movement itself and a short explanation in " +
      "Uzbek. Written on the day of the movement from the data as it stood " +
      "then, so this is the best answer to 'why did we grow', 'nega o'sdik' " +
      "or any question about the history of notable movements. A note flagged " +
      "no_clear_driver means the data showed no cause; report that as the " +
      "finding rather than inventing one.",
    type: "function",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        days: { type: "number", description: "How far back to look, in days." },
        metric: {
          type: "string",
          enum: [...METRIC_KEYS],
          description: "One metric only. Omit for every metric.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_collector_health",
    description:
      "Status of every data collector and when each last ran. Use to check " +
      "whether a surprising number is real or the symptom of a broken feed, " +
      "and answer questions about missing or stale data.",
    type: "function",
    strict: false,
    parameters: noArgs,
  },
];

/** Responses.Tool is a union across tool kinds; ours are all functions. */
export type AskFunctionTool = Extract<OpenAI.Responses.Tool, { type: "function" }>;

export function toolNames(): string[] {
  return (ASK_TOOLS as AskFunctionTool[]).map((tool) => tool.name);
}

/**
 * Bring model-supplied arguments into range.
 *
 * Deliberately total: an unknown tool or a nonsense value produces usable
 * arguments rather than throwing, so dispatch stays the single place that
 * decides a tool call is invalid.
 */
export function clampArgs(tool: string, raw: unknown): Record<string, unknown> {
  const args = (raw ?? {}) as Record<string, unknown>;

  switch (tool) {
    case "get_downloads":
    case "get_conversion_funnel":
    case "get_revenue":
    case "get_active_users":
    case "get_instagram":
      return { days: clampNumber(args.days, DAYS) };

    case "get_reviews": {
      const clamped: Record<string, unknown> = { limit: clampNumber(args.limit, LIMIT) };
      if (typeof args.max_rating === "number") {
        clamped.maxRating = Math.min(5, Math.max(1, Math.round(args.max_rating)));
      }
      return clamped;
    }

    case "get_metric_notes": {
      const clamped: Record<string, unknown> = { days: clampNumber(args.days, DAYS) };
      // Dropped rather than defaulted when unrecognised: a made-up metric name
      // should widen the answer to every metric, not silently redirect it to
      // one the model did not ask about.
      if (isMetricKey(args.metric)) clamped.metric = args.metric;
      return clamped;
    }

    case "get_growth": {
      // Both fall back rather than erroring: an unrecognised key would index a
      // lookup table, and an unrecognised period would reach the bucketer.
      const metric = Object.keys(GROWTH_SERIES).includes(args.metric as string)
        ? (args.metric as GrowthSeriesKey)
        : ("iosDownloads" as GrowthSeriesKey);
      const period = PERIODS.includes(args.period as Period)
        ? (args.period as Period)
        : ("day" as Period);
      return { metric, period };
    }

    default:
      return {};
  }
}
