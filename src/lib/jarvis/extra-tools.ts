import { ASK_TOOLS, type AskFunctionTool, clampArgs } from "@/lib/analyst/tools";
import { EDUCATION_GENRE } from "@/lib/collectors/config";
import type { ProceedsTotal, RankPoint, ReleaseMarker, Trend } from "@/lib/db/queries";
import type { VersionRow } from "@/lib/reviews";

import { tashkentDate } from "./context";

/**
 * Tools Jarvis has beyond the analyst's.
 *
 * The analyst's list (ASK_TOOLS) is also what the unattended 6 am report runs
 * with, so these stay out of it: adding them there would change that report
 * without anyone asking. They read through the same queries the dashboard
 * pages use, so Jarvis never says a different number from the screen, and
 * authority.ts grants each one to the departments whose screens show it.
 */

const RANK_DAYS = { min: 1, max: 90, fallback: 30 };
const RELEASE_DAYS = { min: 1, max: 180, fallback: 90 };
const PROCEEDS_DAYS = { min: 1, max: 365, fallback: 30 };

const noArgs = { type: "object" as const, properties: {} };

function tool(name: string, description: string, parameters: object): AskFunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: false,
    parameters: parameters as AskFunctionTool["parameters"],
  };
}

export const JARVIS_EXTRA_TOOLS: AskFunctionTool[] = [
  tool(
    "get_rank_history",
    "Our position on the Uzbek Education top free chart, one reading per day, with the latest " +
      "position against the one before. Use for how the chart rank has moved over days or weeks. " +
      "A null rank means we were outside the visible chart that day.",
    {
      type: "object",
      properties: {
        days: { type: "number", description: "Days of history, 1 to 90. Defaults to 30." },
        platform: {
          type: "string",
          enum: ["ios", "android"],
          description: "ios for the App Store (the default), android for Google Play.",
        },
      },
    },
  ),
  tool(
    "get_rating_history",
    "Our store rating on the App Store and Google Play: the current average, the one before it, " +
      "and how many ratings there are. Use for whether the rating is going up or down.",
    noArgs,
  ),
  tool(
    "get_installs_today",
    "Google Play installs counted so far today, from Play's running counter. Only Play: Apple " +
      "reports a day or two late. Use for a live read before the daily figures arrive.",
    noArgs,
  ),
  tool(
    "get_releases",
    "The versions of our app we shipped, with the day each was first seen, and how each version " +
      "is rated in reviews: count, average and low ratings. Use for how a release landed.",
    {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to look back, 1 to 180. Defaults to 90." },
      },
    },
  ),
  tool(
    "get_ios_proceeds",
    "App Store proceeds after Apple's cut, by currency. Not the company's revenue: that is " +
      "get_revenue, in som. Usually empty, because the app is paid for through Payme and Click.",
    {
      type: "object",
      properties: {
        days: { type: "number", description: "Days to add up, 1 to 365. Defaults to 30." },
      },
    },
  ),
];

const EXTRA_NAMES = new Set(JARVIS_EXTRA_TOOLS.map((t) => t.name));

/** The analyst's tools, then Jarvis's own. */
export function jarvisTools(): AskFunctionTool[] {
  return [...(ASK_TOOLS as AskFunctionTool[]), ...JARVIS_EXTRA_TOOLS];
}

export function jarvisToolNames(): string[] {
  return jarvisTools().map((t) => t.name);
}

export function isExtraTool(name: string): boolean {
  return EXTRA_NAMES.has(name);
}

function days(raw: unknown, range: { min: number; max: number; fallback: number }): number {
  const value = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(value)) return range.fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export function clampJarvisArgs(name: string, raw: unknown): Record<string, unknown> {
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (name) {
    case "get_rank_history":
      return {
        days: days(args.days, RANK_DAYS),
        platform: args.platform === "android" ? "android" : "ios",
      };
    case "get_releases":
      return { days: days(args.days, RELEASE_DAYS) };
    case "get_ios_proceeds":
      return { days: days(args.days, PROCEEDS_DAYS) };
    case "get_rating_history":
    case "get_installs_today":
      return {};
    default:
      return clampArgs(name, raw);
  }
}

/** One rank per Tashkent day: the last reading of that day, null when off the chart. */
export function dailyRanks(points: readonly RankPoint[]): { date: string; rank: number | null }[] {
  const byDay = new Map<string, { at: string; rank: number | null }>();
  for (const point of points) {
    const date = tashkentDate(new Date(point.capturedAt));
    const seen = byDay.get(date);
    if (!seen || point.capturedAt > seen.at) byDay.set(date, { at: point.capturedAt, rank: point.rank });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { rank }]) => ({ date, rank }));
}

export type ExtraDeps = {
  rankHistory: (
    chartType: string,
    country: string,
    genre: string,
    days: number,
    platform: "ios" | "android",
  ) => Promise<RankPoint[]>;
  rankTrend: (
    chartType: string,
    country: string,
    genre: string,
    platform: "ios" | "android",
  ) => Promise<Trend & { feedSize: number | null }>;
  ratingTrend: (platform: "ios" | "android") => Promise<Trend & { ratingCount: number | null }>;
  androidInstallsSoFarToday: () => Promise<{ installs: number; since: string } | null>;
  iosProceeds: (days: number) => Promise<ProceedsTotal[]>;
  ownReleases: (days: number) => Promise<ReleaseMarker[]>;
  reviewsByVersion: (days: number) => Promise<VersionRow[]>;
};

export async function runExtraTool(
  name: string,
  args: Record<string, unknown>,
  deps: ExtraDeps,
): Promise<unknown> {
  switch (name) {
    case "get_rank_history": {
      const platform = args.platform as "ios" | "android";
      const [history, latest] = await Promise.all([
        deps.rankHistory("topfree", "uz", EDUCATION_GENRE, args.days as number, platform),
        deps.rankTrend("topfree", "uz", EDUCATION_GENRE, platform),
      ]);
      return {
        chart: "Education, top free, Uzbekistan",
        platform,
        latest,
        daily: dailyRanks(history),
      };
    }
    case "get_rating_history": {
      const [ios, android] = await Promise.all([deps.ratingTrend("ios"), deps.ratingTrend("android")]);
      return { ios, android };
    }
    case "get_installs_today": {
      const today = await deps.androidInstallsSoFarToday();
      return today
        ? { ...today, note: "Google Play only, counted since the time given." }
        : {
            installs: null,
            note: "Play has not reported twice today yet, so there is no count. That is not zero.",
          };
    }
    case "get_releases": {
      const [releases, versions] = await Promise.all([
        deps.ownReleases(args.days as number),
        deps.reviewsByVersion(args.days as number),
      ]);
      return { releases, versions };
    }
    case "get_ios_proceeds":
      return {
        proceeds: await deps.iosProceeds(args.days as number),
        note:
          "After Apple's cut, by currency. Empty is normal: the app is paid for through Payme " +
          "and Click, so Apple collects nothing unless an in-app purchase is sold.",
      };
    default:
      throw new Error(`${name} is not one of Jarvis's own tools.`);
  }
}
