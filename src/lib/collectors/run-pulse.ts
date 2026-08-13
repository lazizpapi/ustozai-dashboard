import "server-only";

import {
  fetchInstagramViaApi,
  fetchTelegramMembers,
  type SocialPlatform,
  type SocialSnapshot,
} from "./social";
import { hourBucket, saveSocialSnapshots } from "@/lib/db/persist";
import { socialEnv, type SocialConfig } from "@/lib/env";
import { instagramToken } from "@/lib/db/tokens";

/**
 * The pulse: audience counts only, cheap enough to run every minute.
 *
 * Separate from runPoll rather than a faster version of it, because most of
 * what runPoll collects cannot benefit. Apple recomputes its charts a few
 * times a day, publishes downloads a day in arrears, and moves the rating
 * average in the third decimal. Fetching those every minute would return the
 * same values while making us a nuisance to Apple.
 *
 * What is left is two API calls, which is the whole point: this can run on a
 * page load without anyone noticing.
 */

export interface PulseSummary {
  platforms: SocialPlatform[];
  written: number;
  failures: string[];
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
 * reports every sixty seconds would drown every other source in the table and
 * add half a million rows a year to answer a question already answered better
 * elsewhere. A pulse that stops working shows up as the audience readings
 * ceasing to advance, which is the staleness signal the wall was built around,
 * and the three-hourly poll still records real health for the same platforms.
 */
export async function runPulse(): Promise<PulseSummary> {
  const social = socialEnv();
  const token = social.instagram ? await instagramToken() : null;
  const platforms = pulsePlatforms(social, token !== null);

  if (platforms.length === 0) {
    return { platforms: [], written: 0, failures: [] };
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

  await Promise.all(reads);

  // One platform failing must not discard another's good reading.
  let written = 0;
  if (snapshots.length > 0) {
    try {
      written = await saveSocialSnapshots(snapshots, hourBucket());
    } catch (error) {
      failures.push(`persist: ${message(error)}`);
    }
  }

  return { platforms, written, failures };
}
