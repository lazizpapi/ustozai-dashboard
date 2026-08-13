import type { SocialTrend } from "@/lib/db/queries";

/**
 * Says whether the audience numbers are being read right now.
 *
 * Worth the pixels because the question people ask a wall display is not
 * "what is the number" but "is that the number". Without an answer on screen
 * a figure that has not moved in twenty minutes is indistinguishable from a
 * screen that froze twenty minutes ago, and once a room suspects the second
 * one it stops trusting the first.
 *
 * The word carries the meaning and the dot only decorates it, in the text's
 * own colour rather than a green. Colour on this screen already means iOS or
 * Android, and a fourth hue introduced for a decoration would dilute the two
 * that carry data. The movement is what reads as alive; the hue never was.
 */

/** Comfortably more than the refresh interval, so one missed beat is not an outage. */
const LIVE_WITHIN_MS = 3 * 60 * 1000;

export function audienceIsLive(trends: SocialTrend[], now: number = Date.now()): boolean {
  return trends.some((trend) => {
    if (trend.checkedAt === null) return false;
    const at = new Date(trend.checkedAt).getTime();
    return Number.isFinite(at) && now - at < LIVE_WITHIN_MS;
  });
}

export function LiveDot() {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-[0.4vw] text-[clamp(0.65rem,0.75vw,1rem)]">
      <span
        className="size-[0.45vw] min-h-1.5 min-w-1.5 animate-pulse rounded-full bg-current"
        aria-hidden
      />
      live
    </span>
  );
}
