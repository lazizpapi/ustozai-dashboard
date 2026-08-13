import "server-only";

import { runPulse } from "./run-pulse";
import { latestAudienceCheck } from "@/lib/db/queries";

/**
 * Read the audience counts during a page render when the stored ones are old.
 *
 * This is what makes refreshing the page mean something. Without it the screen
 * can only ever show what the last scheduled run happened to catch, so the
 * honest answer to "is this current?" was "within three hours".
 *
 * Three properties make it safe to call from a server component:
 *
 * It is conditional. A reading younger than the window is returned as-is, so
 * opening five pages in a minute costs five cheap timestamp queries and no
 * outbound requests at all.
 *
 * It is bounded. A slow or hanging platform must not hold a page render, so
 * the wait is capped and the render proceeds with the stored value. The write
 * still lands when the request finishes and the next render picks it up.
 *
 * It never throws. Freshening is an enhancement; failing at it must leave the
 * page rendering exactly what it would have rendered anyway.
 */

/**
 * How old a reading may be before a page load goes and gets a new one.
 *
 * Slightly under the wall display's own refresh interval, so each of its
 * refreshes is due for a real read rather than alternating between a fresh one
 * and a repeat of the last.
 */
export const PULSE_MAX_AGE_MS = 55_000;

/**
 * How long a render will wait. Telegram answers in a few hundred milliseconds
 * from Frankfurt, so this is generous; it is a ceiling on the bad case, not a
 * target.
 */
const PULSE_BUDGET_MS = 2_500;

/** Pure, so the boundary conditions are testable without a clock or a database. */
export function isDue(
  lastCheckedAt: string | null,
  now: number,
  maxAgeMs: number = PULSE_MAX_AGE_MS,
): boolean {
  if (lastCheckedAt === null) return true;

  const at = new Date(lastCheckedAt).getTime();
  // An unparseable timestamp is treated as no reading rather than as fresh:
  // the failure should be a redundant fetch, not a permanently stale screen.
  if (!Number.isFinite(at)) return true;

  return now - at >= maxAgeMs;
}

/**
 * Shared across concurrent renders.
 *
 * The wall display, someone's laptop and a phone can all render within the
 * same second, and the timestamp check does not separate them: all three read
 * the same old value before any of them has written a new one. Holding the
 * in-flight promise collapses them into one read, the same fix the apps table
 * lookup needed for the same reason.
 *
 * Per instance rather than global, so a few extra reads are possible across
 * instances. That is a handful of requests a day, not a stampede.
 */
let inFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshAudienceIfStale(): Promise<void> {
  try {
    if (!isDue(await latestAudienceCheck(), Date.now())) return;

    inFlight ??= runPulse()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });

    await Promise.race([inFlight, sleep(PULSE_BUDGET_MS)]);
  } catch {
    // Includes the timestamp query itself failing. The page renders regardless.
  }
}
