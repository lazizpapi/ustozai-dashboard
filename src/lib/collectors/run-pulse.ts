import "server-only";

import {
  fetchInstagramViaApi,
  fetchTelegramMembers,
  type SocialPlatform,
  type SocialSnapshot,
} from "./social";
import { fetchLatestReviews } from "./itunes-reviews";
import { hourBucket, saveReviews, saveSocialSnapshots } from "@/lib/db/persist";
import { socialEnv, type SocialConfig } from "@/lib/env";
import { instagramToken } from "@/lib/db/tokens";

/**
 * The pulse: the handful of things that can change between two consecutive
 * reads, cheap enough to run every few minutes.
 *
 * Separate from runPoll rather than a faster version of it, because most of
 * what runPoll collects cannot benefit. Apple recomputes its charts a few
 * times a day, publishes downloads a day in arrears, and moves the rating
 * average in the third decimal. Google's public install counter sits still for
 * about a day and then jumps by a whole day at once, measured. Fetching any of
 * those every few minutes would return the same values while making us a
 * nuisance to the people serving them.
 *
 * Audience counts run on every invocation and are light enough for a page
 * render. Reviews are opt-in because they belong only to the scheduled caller:
 * see the note on the option below.
 */

export interface PulseOptions {
  /**
   * Fetch page one of the reviews feed as well.
   *
   * Off by default so the render-time path stays two API calls. The cron
   * caller turns it on: a new review reaching the screen in minutes is worth
   * one extra request every five minutes, but it is not worth adding latency
   * to somebody loading a page.
   */
  includeReviews?: boolean;
}

export interface PulseSummary {
  platforms: SocialPlatform[];
  written: number;
  /** Genuinely new reviews inserted, 0 when not requested. */
  reviews: number;
  failures: string[];
}

/**
 * Whether there is anything to do at all.
 *
 * Extracted and tested rather than inlined because the obvious version of this
 * check is wrong in a way nothing would report: an early return that asks only
 * whether a social platform qualifies will silently skip reviews on a run that
 * was requested precisely for them.
 */
export function pulseHasWork(
  platforms: SocialPlatform[],
  includeReviews: boolean,
): boolean {
  return platforms.length > 0 || includeReviews;
}

/**
 * Which platforms are worth reading at this cadence.
 *
 * Pure so the reasoning is testable, and the reasoning is the valuable part:
 *
 * Telegram always qualifies. getChatMemberCount is documented, exact, and one
 * request a minute is nothing against the Bot API's limits.
 *
 * Instagram qualifies only with a token. Without one the collector falls back
 * to the scrape, which datacenter addresses are already refused for; calling
 * it sixty times more often would turn an intermittent block into a firm one.
 * The three-hourly poll still attempts it, so nothing is lost by waiting.
 *
 * YouTube never qualifies, and this is not caution. YouTube rounds every
 * subscriber count to three significant figures, in its official Data API as
 * much as on the page, so at 174K the value cannot change until the channel
 * crosses 174,500. Every extra read is guaranteed to return the same string.
 */
export function pulsePlatforms(
  social: SocialConfig,
  hasInstagramToken: boolean,
): SocialPlatform[] {
  const eligible: SocialPlatform[] = [];
  if (social.telegram) eligible.push("telegram");
  if (social.instagram && hasInstagramToken) eligible.push("instagram");
  return eligible;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deliberately does not write to collector_runs.
 *
 * The health panel shows the most recent run per source, so a source that
 * reports every few minutes would drown every other source in the table and
 * add hundreds of thousands of rows a year to answer a question already
 * answered better elsewhere. A pulse that stops working shows up as the
 * readings ceasing to advance, which is the staleness signal the wall was
 * built around, and the hourly poll still records real health for every source
 * this touches, reviews included.
 *
 * Failures are returned instead, which the cron caller returns in its response
 * body, which pg_net stores in net._http_response. That table is already the
 * documented place to look when a scheduled call misbehaves.
 */
export async function runPulse(options: PulseOptions = {}): Promise<PulseSummary> {
  const includeReviews = options.includeReviews ?? false;
  const social = socialEnv();
  const token = social.instagram ? await instagramToken() : null;
  const platforms = pulsePlatforms(social, token !== null);

  if (!pulseHasWork(platforms, includeReviews)) {
    return { platforms: [], written: 0, reviews: 0, failures: [] };
  }

  const snapshots: SocialSnapshot[] = [];
  const failures: string[] = [];

  const reads = platforms.map(async (platform) => {
    try {
      if (platform === "telegram") {
        snapshots.push(
          await fetchTelegramMembers(social.telegram!.channel, social.telegram!.botToken),
        );
      } else if (platform === "instagram") {
        snapshots.push(await fetchInstagramViaApi(token!.accessToken, social.instagram!.handle));
      }
    } catch (error) {
      failures.push(`${platform}: ${message(error)}`);
    }
  });

  /*
   * Reviews run alongside the audience reads rather than after them. They are
   * independent sources, and the review fetch retries on an empty feed, so
   * sequencing it would put that retry backoff in front of a Telegram count
   * that was already in hand.
   */
  let reviews = 0;
  const reviewRead = includeReviews
    ? (async () => {
        try {
          reviews = await saveReviews(await fetchLatestReviews("uz"));
        } catch (error) {
          failures.push(`itunes-reviews:pulse: ${message(error)}`);
        }
      })()
    : Promise.resolve();

  await Promise.all([...reads, reviewRead]);

  // One platform failing must not discard another's good reading.
  let written = 0;
  if (snapshots.length > 0) {
    try {
      written = await saveSocialSnapshots(snapshots, hourBucket());
    } catch (error) {
      failures.push(`persist: ${message(error)}`);
    }
  }

  return { platforms, written, reviews, failures };
}
