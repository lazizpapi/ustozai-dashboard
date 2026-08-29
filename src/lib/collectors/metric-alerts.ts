import { escapeHtml } from "./alerts";
import { sendTelegramMessage } from "@/lib/digest/telegram";
import type { MetricKey } from "@/lib/metric-keys";

/**
 * Telling somebody the numbers moved, not just that a collector stopped.
 *
 * The existing alert answers "is the pipeline healthy". A perfectly healthy
 * pipeline will happily record the app falling eleven places overnight and say
 * nothing, because nothing broke. This is the other half: the collectors are
 * fine and the news is bad.
 *
 * Or good. The rules used to fire only downward, on the reasoning that good
 * news can wait for somebody to open the dashboard. That was wrong in one
 * expensive way: a jump nobody notices on the day it happens is a jump nobody
 * can explain a week later, when the release that caused it has been followed
 * by three more. Every rule now has its mirror, and the direction rides along
 * on the movement rather than being implied by the rule that found it.
 *
 * Every rule here compares two readings and returns either one movement or
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
 * and that is what makes it fire once. Rank, rating and followers compare today
 * against yesterday, so tomorrow compares a fresh pair and stays quiet. The
 * series rules cannot be phrased that way, since their whole point is one day
 * measured against the fortnight behind it, so they evaluate themselves twice
 * and report only when today crosses the line and yesterday had not.
 */

export interface MetricAlert {
  /** What moved, named as the dashboard names it. */
  metric: string;
  /** The movement, with both numbers in it so the message stands alone. */
  detail: string;
}

/** What moved, in the two forms the rest of the system needs it in. */
export interface MetricSubject {
  /** The stable key a stored note is filed against. */
  key: MetricKey;
  /** The human label, which a tile may rename without breaking anything. */
  label: string;
}

export interface Movement extends MetricAlert {
  metricKey: MetricKey;
  /**
   * The metric's fortunes, not the raw arithmetic.
   *
   * Rank counts upward as fortunes fall, so a rank going from #12 to #4 is
   * "up" here. Anything reading this to decide whether the news is good would
   * otherwise have to know which metrics are inverted, and one of them
   * eventually would not.
   */
  direction: "up" | "down";
  /** The Tashkent day the movement describes. */
  date: string;
  /** Both readings, for whoever has to explain the movement later. */
  magnitude: { current: number | null; previous: number | null };
}

/** A movement with the note somebody wrote about it, where one exists. */
export interface AlertLine extends MetricAlert {
  noteUz?: string;
}

/** Longer than this and the message stops being readable on a phone. */
const MAX_LISTED = 6;

/** A note is a paragraph, not an essay, and Telegram has to carry it. */
const MAX_NOTE_CHARS = 300;

/** A rank moving more than this in a day is worth waking up for. */
export const RANK_DROP_PLACES = 5;
export const RANK_IMPROVE_PLACES = 5;

/** Below this share of the fortnight's typical day, a day is a slump. */
export const DOWNLOAD_SLUMP_SHARE = 0.4;
/** Above this multiple of it, a day is a surge. */
export const DOWNLOAD_SURGE_SHARE = 2;

/** Ratings move in hundredths, so this is a real move rather than rounding. */
export const RATING_DROP = 0.05;
export const RATING_RISE = 0.05;

/**
 * Takings sit far wider than downloads, because they are counted in customers.
 *
 * A day's takings come from between two and thirty transactions, so a single
 * large purchase moves the day by more than half, and the distribution is
 * skewed enough that the median sits well above the typical day. Against the
 * download bars roughly a third of all days cross, and an alert firing every
 * third morning is not news about the business, it is the arithmetic of small
 * numbers read aloud.
 *
 * These were picked by replaying two months of real takings rather than by
 * taste. At 0.25 the rule spoke every ten days and five of its six messages
 * were quiet purchase days with nothing behind them to find. At 0.2 it keeps
 * the genuinely extreme days and speaks about twice a month.
 */
export const REVENUE_SLUMP_SHARE = 0.2;
export const REVENUE_SURGE_SHARE = 3;

/** Active users are the steadiest series we have, so a smaller move is news. */
export const ACTIVE_SLUMP_SHARE = 0.5;
export const ACTIVE_SURGE_SHARE = 1.5;

/**
 * Followers move by percentage, with an absolute floor underneath.
 *
 * The floor is not really about small numbers. YouTube publishes a rounded
 * figure, and at our size it rounds to the nearest thousand, so the count
 * appears to jump by a thousand on a day nothing happened. Two per cent clears
 * that comfortably at every account we track. The floor is what stops the same
 * rule generating daily news from double-digit wobble if a smaller account is
 * ever added.
 */
export const FOLLOWER_MOVE_SHARE = 0.02;
export const MIN_FOLLOWER_MOVE = 500;

/** Fewer readings than this and "typical" is not a thing worth computing. */
const MIN_DAYS_FOR_MEDIAN = 7;

/**
 * The days that are over, which are the only ones worth comparing.
 *
 * Takings and active users both accumulate through the day, and the daily run
 * fires at six in the morning Tashkent time. Today's row at that hour holds
 * about six hours of a day, so measuring it against a fortnight of complete
 * days finds a collapse every single morning, buys a model call to explain it,
 * and reports the sun coming up.
 *
 * Nor does the debounce save us: by the time the run fires, yesterday's row has
 * been restated and is complete, so it looks healthy and today looks new. The
 * false alarm would clear the crossing test every day forever.
 *
 * Downloads are unaffected, Apple publishing a day behind regardless, but they
 * are filtered too. A rule whose correctness depends on which feed it happens
 * to be reading is one refactor away from being wrong.
 */
export function completeDays<T extends { date: string }>(days: T[], today: string): T[] {
  return days.filter((day) => day.date < today);
}

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
 * A null on both sides says nothing.
 */
export function checkRankDrop(
  subject: MetricSubject,
  date: string,
  today: number | null,
  yesterday: number | null,
  feedSize: number | null = null,
  places = RANK_DROP_PLACES,
): Movement | null {
  if (yesterday === null) return null;

  if (today === null) {
    const outside = feedSize ? `the top ${feedSize}` : "the chart";
    return {
      metric: subject.label,
      metricKey: subject.key,
      direction: "down",
      date,
      magnitude: { current: null, previous: yesterday },
      detail: `outside ${outside}, was #${yesterday} yesterday`,
    };
  }

  // Rank counts upward as fortunes fall, so a positive difference is bad news.
  const slipped = today - yesterday;
  if (slipped <= places) return null;

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: "down",
    date,
    magnitude: { current: today, previous: yesterday },
    detail: `#${today}, down ${slipped} places from #${yesterday} yesterday`,
  };
}

/**
 * Climbing the chart, or arriving on it.
 *
 * The mirror of the fall, including the vanishing case in reverse: appearing
 * out of nowhere is the loudest good news the chart can carry, and it is the
 * one most likely to be missed, because there is no previous number sitting
 * next to it looking wrong.
 */
export function checkRankImprovement(
  subject: MetricSubject,
  date: string,
  today: number | null,
  yesterday: number | null,
  feedSize: number | null = null,
  places = RANK_IMPROVE_PLACES,
): Movement | null {
  if (today === null) return null;

  if (yesterday === null) {
    const outside = feedSize ? `the top ${feedSize}` : "the chart";
    return {
      metric: subject.label,
      metricKey: subject.key,
      direction: "up",
      date,
      magnitude: { current: today, previous: null },
      detail: `#${today}, was outside ${outside} yesterday`,
    };
  }

  const climbed = yesterday - today;
  if (climbed <= places) return null;

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: "up",
    date,
    magnitude: { current: today, previous: yesterday },
    detail: `#${today}, up ${climbed} places from #${yesterday} yesterday`,
  };
}

interface SeriesBounds {
  /** Below this share of the typical day, the day is a slump. */
  slumpShare: number;
  /** At or above this multiple of it, the day is a surge. */
  surgeShare: number;
  /** Appended to every figure, for series whose numbers need naming. */
  unit?: string;
}

/**
 * A day well away from the fortnight around it, in either direction.
 *
 * Measured against the median rather than the mean on purpose: a single
 * launch-day spike drags a mean up far enough that the ordinary days after it
 * all look like slumps, which is how a threshold ends up muted.
 */
function seriesMoveOn(
  subject: MetricSubject,
  days: { date: string; value: number }[],
  bounds: SeriesBounds,
): Movement | null {
  if (days.length < MIN_DAYS_FOR_MEDIAN + 1) return null;

  const latest = days[days.length - 1];
  const typical = median(days.slice(0, -1).map((day) => day.value));
  if (typical === null || typical <= 0) return null;

  const low = latest.value < typical * bounds.slumpShare;
  const high = latest.value >= typical * bounds.surgeShare;
  if (!low && !high) return null;

  const unit = bounds.unit ? ` ${bounds.unit}` : "";

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: low ? "down" : "up",
    date: latest.date,
    magnitude: { current: latest.value, previous: Math.round(typical) },
    detail:
      `${latest.value}${unit} on ${latest.date}, ` +
      `against a typical ${Math.round(typical)}${unit} a day`,
  };
}

/**
 * The debounced form: fires the day the series crosses, not every day after.
 *
 * Suppression is direction-aware. A slump yesterday and a surge today is two
 * pieces of news, and collapsing them into one would hide the recovery, which
 * is the half somebody actually wants to hear about.
 */
export function checkSeriesMove(
  subject: MetricSubject,
  days: { date: string; value: number }[],
  bounds: SeriesBounds,
): Movement | null {
  const today = seriesMoveOn(subject, days, bounds);
  if (today === null) return null;

  // Already said yesterday. A slump lasting a fortnight is one piece of news,
  // not fourteen, and the dashboard is where somebody goes to see whether it
  // is still going.
  const yesterday = seriesMoveOn(subject, days.slice(0, -1), bounds);
  if (yesterday !== null && yesterday.direction === today.direction) return null;

  return today;
}

/**
 * Downloads, kept as their own names because that is what the daily run calls
 * them and because the shape of a download row differs from the generic one.
 */
export function checkDownloadSlump(
  subject: MetricSubject,
  days: { date: string; downloads: number }[],
  share = DOWNLOAD_SLUMP_SHARE,
): Movement | null {
  const move = checkSeriesMove(subject, asSeries(days), {
    slumpShare: share,
    // Out of reach, so this call can only ever report a slump.
    surgeShare: Number.POSITIVE_INFINITY,
  });
  return move?.direction === "down" ? move : null;
}

export function checkDownloadSurge(
  subject: MetricSubject,
  days: { date: string; downloads: number }[],
  share = DOWNLOAD_SURGE_SHARE,
): Movement | null {
  const move = checkSeriesMove(subject, asSeries(days), {
    // Out of reach in the other direction, for the same reason.
    slumpShare: 0,
    surgeShare: share,
  });
  return move?.direction === "up" ? move : null;
}

function asSeries(days: { date: string; downloads: number }[]) {
  return days.map((day) => ({ date: day.date, value: day.downloads }));
}

/**
 * A rating moving between one reading and the next.
 *
 * Deliberately day against day rather than against a week ago, so it reports
 * the move on the day it happens and then stops. Comparing against a week
 * would keep finding the same drop for the six days after it, and a rating
 * holding steady at its new level is not news.
 *
 * The cost is a slow bleed: a hundredth a day for a week is a real fall this
 * will never report. Ratings on this account move in visible steps rather
 * than drifting, and the weekly change is on the dashboard for the other case.
 */
export function checkRatingDrop(
  subject: MetricSubject,
  date: string,
  current: number | null,
  previous: number | null,
  threshold = RATING_DROP,
): Movement | null {
  if (current === null || previous === null) return null;

  const fall = previous - current;
  if (fall < threshold) return null;

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: "down",
    date,
    magnitude: { current, previous },
    detail: `${current.toFixed(2)}, down from ${previous.toFixed(2)}`,
  };
}

export function checkRatingRise(
  subject: MetricSubject,
  date: string,
  current: number | null,
  previous: number | null,
  threshold = RATING_RISE,
): Movement | null {
  if (current === null || previous === null) return null;

  const rise = current - previous;
  if (rise < threshold) return null;

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: "up",
    date,
    magnitude: { current, previous },
    detail: `${current.toFixed(2)}, up from ${previous.toFixed(2)}`,
  };
}

/**
 * A follower count moving in a day, either way.
 *
 * One rule for both directions rather than a pair, because unlike rank and
 * rating there is nothing asymmetric about it: the same threshold means the
 * same thing going up as going down, and losing two per cent of an audience is
 * exactly as interesting as gaining it.
 */
export function checkFollowerMove(
  subject: MetricSubject,
  date: string,
  current: number | null,
  previous: number | null,
  options: { share?: number; minimum?: number } = {},
): Movement | null {
  if (current === null || previous === null || previous <= 0) return null;

  const share = options.share ?? FOLLOWER_MOVE_SHARE;
  const minimum = options.minimum ?? MIN_FOLLOWER_MOVE;

  const moved = current - previous;
  const size = Math.abs(moved);
  if (size < minimum || size < previous * share) return null;

  const way = moved > 0 ? "up" : "down";

  return {
    metric: subject.label,
    metricKey: subject.key,
    direction: way,
    date,
    magnitude: { current, previous },
    detail: `${current}, ${way} ${size} from ${previous} yesterday`,
  };
}

/** A note is a paragraph. Anything longer was not written for a phone. */
function trimNote(note: string): string {
  const clean = note.trim();
  if (clean.length <= MAX_NOTE_CHARS) return clean;
  return `${clean.slice(0, MAX_NOTE_CHARS).trimEnd()}...`;
}

/**
 * The message, or null when the numbers behaved.
 *
 * Null rather than an empty string so a quiet day cannot send a blank message,
 * matching how the collector alert does it.
 *
 * Where a movement has a note, the note goes underneath it rather than beside
 * it. The movement is the news and stays scannable; the explanation is the
 * paragraph you read only if the news interests you.
 */
export function formatMetricAlert(alerts: AlertLine[]): string | null {
  if (alerts.length === 0) return null;

  const lines = ["<b>Worth a look</b>"];
  for (const alert of alerts.slice(0, MAX_LISTED)) {
    lines.push(`  ${escapeHtml(alert.metric)}: ${escapeHtml(alert.detail)}`);
    if (alert.noteUz) lines.push(`  <i>${escapeHtml(trimNote(alert.noteUz))}</i>`);
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
export async function notifyMetricAnomalies(alerts: AlertLine[]): Promise<void> {
  try {
    const message = formatMetricAlert(alerts);
    if (!message) return;

    const result = await sendTelegramMessage(message);
    if (!result.sent) console.error("could not send metric alert:", result.reason);
  } catch (error) {
    console.error("could not send metric alert:", error);
  }
}
