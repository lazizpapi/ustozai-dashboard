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
  /**
   * Overall wall-clock budget, after which the run returns what it has.
   *
   * Only the cron caller sets this, because only it runs against a platform
   * ceiling that would otherwise kill the function mid-flight and discard the
   * response body. The render-time path in freshen.ts is already bounded by
   * its own race and leaves this unset.
   */
  deadlineMs?: number;
}

/**
 * How long the scheduled pulse may run before it reports back regardless.
 *
 * Comfortably under the route's maxDuration of 30, so the run is always the
 * one that decides to stop. A platform kill returns no body at all, and the
 * body is what pg_net stores in net._http_response — the documented first
 * place to look when the wall goes stale.
 */
export const PULSE_DEADLINE_MS = 25_000;

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
 * A timer that can be cancelled, so a run that finishes early does not leave a
 * live handle behind holding the function open.
 */
function deadline(ms: number): { reached: Promise<true>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const reached = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), ms);
  });
  return { reached, cancel: () => clearTimeout(timer) };
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
   * The audience write is chained onto the audience reads alone, never onto
   * the reviews below.
   *
   * Waiting for everything before writing anything is what made a slow Apple
   * feed cost audience data: the Telegram count was already in hand when the
   * platform killed the function at thirty seconds, and it died in memory
   * having never been written. Persisting as soon as the reads settle means a
   * later timeout can cost the reviews, which the hourly walk re-collects, and
   * not the counts, which nothing can recover for a moment that has passed.
   *
   * One platform failing must still not discard another's good reading.
   */
  let written = 0;
  const audiencePhase = Promise.all(reads).then(async () => {
    if (snapshots.length === 0) return;
    try {
      written = await saveSocialSnapshots(snapshots, hourBucket());
    } catch (error) {
      failures.push(`persist: ${message(error)}`);
    }
  });

  /*
   * Reviews run alongside the audience reads rather than after them. They are
   * independent sources, and the review fetch retries on an empty feed, so
   * sequencing it would put that retry backoff in front of a Telegram count
   * that was already in hand.
   */
  let reviews = 0;
  const reviewPhase = includeReviews
    ? (async () => {
        try {
          reviews = await saveReviews(await fetchLatestReviews("uz"));
        } catch (error) {
          failures.push(`itunes-reviews:pulse: ${message(error)}`);
        }
      })()
    : Promise.resolve();

  /*
   * Neither phase above rejects; they record their own failures. The catch is
   * for the case that is not supposed to happen, and it must be here rather
   * than left to the caller: once the deadline below wins the race, nothing is
   * awaiting this promise any more, and a late rejection with no handler takes
   * the whole function down instead of the one source that broke.
   *
   * Recording it also fits the route's convention better than throwing did. A
   * run that got partway through has happened, and a non-2xx there is supposed
   * to mean the run could not happen at all.
   */
  const work = Promise.all([audiencePhase, reviewPhase]).catch((error) => {
    failures.push(`pulse: ${message(error)}`);
  });

  /*
   * Returning a partial summary beats being killed holding a complete one.
   * Every count above is a closure variable, so whatever landed before the
   * deadline is already reflected in what is returned.
   */
  if (options.deadlineMs === undefined) {
    await work;
  } else {
    const timer = deadline(options.deadlineMs);
    try {
      const timedOut = await Promise.race([work.then(() => false), timer.reached]);
      if (timedOut) failures.push("pulse: deadline exceeded");
    } finally {
      timer.cancel();
    }
  }

  return { platforms, written, reviews, failures };
}
