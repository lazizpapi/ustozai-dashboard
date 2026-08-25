import { escapeHtml } from "./alerts";
import { sendTelegramMessage } from "@/lib/digest/telegram";

/**
 * Telling somebody the numbers moved, not just that a collector stopped.
 *
 * The existing alert answers "is the pipeline healthy". A perfectly healthy
 * pipeline will happily record the app falling eleven places overnight and say
 * nothing, because nothing broke. This is the other half: the collectors are
 * fine and the news is bad.
 *
 * Every rule here compares two readings and returns either one alert or
 * nothing, so the rules are pure and can be tested against invented numbers
 * without a database anywhere near them.
 *
 * Why this rides the daily run rather than the hourly poll, which is the
 * opposite of where the collector alert lives: these rules have no memory. The
 * collector alert gets change-only semantics for free, because it compares the
 * previous run's statuses against this one's. A metric rule comparing today
 * against yesterday is still true an hour later, so on the hourly poll a
 * single bad day would send the same message twenty-four times.
 *
 * Running daily is not enough on its own, though. A rule phrased as a state
 * rather than a movement stays true for as long as the state lasts, so a slump
 * holding for a fortnight would send a fortnight of identical messages, which
 * is how a channel gets muted, and a muted channel is worse than no channel
 * because it looks like coverage.
 *
 * So every rule here is phrased as a movement between two adjacent readings,
 * and that is what makes it fire once. Rank and rating compare today against
 * yesterday, so tomorrow compares a fresh pair and stays quiet. The slump rule
 * cannot be phrased that way, since its whole point is one day measured
 * against its fortnight, so it evaluates itself twice and reports only when
 * today crosses the line and yesterday had not.
 */

export interface MetricAlert {
  /** What moved, named as the dashboard names it. */
  metric: string;
  /** The movement, with both numbers in it so the message stands alone. */
  detail: string;
}

/** Longer than this and the message stops being readable on a phone. */
const MAX_LISTED = 6;

/** A rank worsening by more than this in a day is worth waking up for. */
export const RANK_DROP_PLACES = 5;

/** Below this share of the fortnight's typical day, a day is a slump. */
export const DOWNLOAD_SLUMP_SHARE = 0.4;

/** Ratings move in hundredths, so this is a real fall rather than rounding. */
export const RATING_DROP = 0.05;

/** Fewer readings than this and "typical" is not a thing worth computing. */
const MIN_DAYS_FOR_MEDIAN = 7;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Falling down the chart, or off it.
 *
 * Two separate pieces of news share this rule. Sliding places is the ordinary
 * one. Leaving the feed altogether arrives as a null rank, which is a real
 * reading meaning "polled fine, not in the top hundred" rather than missing
 * data, and it is the more urgent of the two: a number that vanishes is easier
 * to miss than a number that got worse.
 *
 * A null on both sides says nothing, and climbing says nothing. Good news is
 * not an alert.
 */
export function checkRankDrop(
  metric: string,
  today: number | null,
  yesterday: number | null,
  feedSize: number | null = null,
  places = RANK_DROP_PLACES,
): MetricAlert | null {
  if (yesterday === null) return null;

  if (today === null) {
    const outside = feedSize ? `the top ${feedSize}` : "the chart";
    return { metric, detail: `outside ${outside}, was #${yesterday} yesterday` };
  }

  // Rank counts upward as fortunes fall, so a positive difference is bad news.
  const slipped = today - yesterday;
  if (slipped <= places) return null;

  return {
    metric,
    detail: `#${today}, down ${slipped} places from #${yesterday} yesterday`,
  };
}

/**
 * A day well below the fortnight around it.
 *
 * Measured against the median rather than the mean on purpose: a single
 * launch-day spike drags a mean up far enough that the ordinary days after it
 * all look like slumps, which is how a threshold ends up muted.
 */
function slumpOn(
  metric: string,
  days: { date: string; downloads: number }[],
  share: number,
): MetricAlert | null {
  if (days.length < MIN_DAYS_FOR_MEDIAN + 1) return null;

  const latest = days[days.length - 1];
  const typical = median(days.slice(0, -1).map((day) => day.downloads));
  if (typical === null || typical <= 0) return null;

  if (latest.downloads >= typical * share) return null;

  return {
    metric,
    detail: `${latest.downloads} on ${latest.date}, against a typical ${Math.round(typical)} a day`,
  };
}

export function checkDownloadSlump(
  metric: string,
  days: { date: string; downloads: number }[],
  share = DOWNLOAD_SLUMP_SHARE,
): MetricAlert | null {
  const today = slumpOn(metric, days, share);
  if (today === null) return null;

  // Already said yesterday. A slump lasting a fortnight is one piece of news,
  // not fourteen, and the dashboard is where somebody goes to see whether it
  // is still going.
  if (slumpOn(metric, days.slice(0, -1), share) !== null) return null;

  return today;
}

/**
 * A rating falling between one reading and the next.
 *
 * Deliberately day against day rather than against a week ago, so it reports
 * the fall on the day it happens and then stops. Comparing against a week
 * would keep finding the same drop for the six days after it, and a rating
 * holding steady at its new level is not news.
 *
 * The cost is a slow bleed: a hundredth a day for a week is a real fall this
 * will never report. Ratings on this account move in visible steps rather
 * than drifting, and the weekly change is on the dashboard for the other case.
 */
export function checkRatingDrop(
  metric: string,
  current: number | null,
  previous: number | null,
  threshold = RATING_DROP,
): MetricAlert | null {
  if (current === null || previous === null) return null;

  const fall = previous - current;
  if (fall < threshold) return null;

  return {
    metric,
    detail: `${current.toFixed(2)}, down from ${previous.toFixed(2)}`,
  };
}

/**
 * The message, or null when the numbers behaved.
 *
 * Null rather than an empty string so a quiet day cannot send a blank message,
 * matching how the collector alert does it.
 */
export function formatMetricAlert(alerts: MetricAlert[]): string | null {
  if (alerts.length === 0) return null;

  const lines = ["<b>Worth a look</b>"];
  for (const alert of alerts.slice(0, MAX_LISTED)) {
    lines.push(`  ${escapeHtml(alert.metric)}: ${escapeHtml(alert.detail)}`);
  }

  const hidden = alerts.length - MAX_LISTED;
  if (hidden > 0) lines.push(`  and ${hidden} more`);

  return lines.join("\n");
}

/**
 * Format and send. Never throws.
 *
 * A daily run must not fail because Telegram is unreachable, for the same
 * reason the collector alert is written this way: a function whose job is to
 * report trouble should not become the trouble.
 */
export async function notifyMetricAnomalies(alerts: MetricAlert[]): Promise<void> {
  try {
    const message = formatMetricAlert(alerts);
    if (!message) return;

    const result = await sendTelegramMessage(message);
    if (!result.sent) console.error("could not send metric alert:", result.reason);
  } catch (error) {
    console.error("could not send metric alert:", error);
  }
}
