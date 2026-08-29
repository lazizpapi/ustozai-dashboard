import "server-only";

import { explainMovements, movementKey } from "./explain";
import {
  ACTIVE_SLUMP_SHARE,
  ACTIVE_SURGE_SHARE,
  DOWNLOAD_SLUMP_SHARE,
  DOWNLOAD_SURGE_SHARE,
  REVENUE_SLUMP_SHARE,
  REVENUE_SURGE_SHARE,
  checkSeriesMove,
  completeDays,
  type Movement,
  type MetricSubject,
} from "@/lib/collectors/metric-alerts";
import { dauSeries, iosDailyDownloads, revenueSummary } from "@/lib/db/queries";
import { localDate } from "@/lib/growth";

/**
 * Explaining movements that already happened.
 *
 * The daily run only ever looks at the newest day, which is right for a job
 * that runs every morning and wrong the first time it is switched on: the feed
 * starts empty and stays empty until the next notable day, which on these
 * numbers is about a week away. Everything before that is unexplained, and the
 * data that would explain it is still sitting there.
 *
 * So this replays the rules over a window of days, as though the daily run had
 * fired on each of those mornings, and explains what it finds. It is also the
 * repair for the ordinary case: a run that was skipped, or a stretch where the
 * model key was missing, leaves the same gap.
 *
 * Only the three series rules are replayed. Rank, rating and follower rules
 * compare a day against the one before it, and the queries behind them keep a
 * one-day window, so replaying those would mean claiming a comparison we no
 * longer hold the readings for. A movement this cannot reconstruct is better
 * left absent than reconstructed wrongly.
 *
 * Idempotent by the same key everything else uses: a movement already noted is
 * skipped rather than explained a second time.
 */

export interface BackfillSummary {
  /** Movements the rules found in the window, whether or not they got a note. */
  found: Movement[];
  /** Notes actually written this run, newest movement first. */
  written: { metricKey: string; date: string; noteUz: string }[];
}

interface Series {
  subject: MetricSubject;
  days: { date: string; value: number }[];
  bounds: { slumpShare: number; surgeShare: number; unit?: string };
}

/**
 * Every movement the series rules would have reported across the window.
 *
 * Pure, so the replay itself is testable without a database or a model. Walks
 * each series forward one day at a time and asks the same question the daily
 * run asks, which is what makes the result identical to what would have been
 * sent on those mornings rather than merely similar.
 */
export function replaySeries(series: Series[], window: number): Movement[] {
  const movements: Movement[] = [];

  for (const entry of series) {
    // Enough history behind the first judged day for a median to mean
    // anything; the rule itself refuses to speak without it.
    const from = Math.max(9, entry.days.length - window);
    for (let end = from; end <= entry.days.length; end += 1) {
      const move = checkSeriesMove(entry.subject, entry.days.slice(0, end), entry.bounds);
      if (move) movements.push(move);
    }
  }

  // Newest first, so a capped run explains the most recent news rather than
  // whichever series happened to be listed first.
  return movements.sort((a, b) => b.date.localeCompare(a.date));
}

export async function backfillNotes(window = 30): Promise<BackfillSummary> {
  const [downloads, revenue, dau] = await Promise.all([
    iosDailyDownloads(window + 21),
    revenueSummary(window + 21),
    dauSeries(window + 21),
  ]);

  const today = localDate(new Date().toISOString());

  const series: Series[] = [
    {
      subject: { key: "ios_downloads", label: "App Store downloads" },
      days: completeDays(
        downloads.map((day) => ({ date: day.date, value: day.downloads })),
        today,
      ),
      bounds: { slumpShare: DOWNLOAD_SLUMP_SHARE, surgeShare: DOWNLOAD_SURGE_SHARE },
    },
    {
      subject: { key: "revenue", label: "Takings" },
      days: completeDays(
        revenue.daily.map((day) => ({ date: day.date, value: day.amount })),
        today,
      ),
      bounds: {
        slumpShare: REVENUE_SLUMP_SHARE,
        surgeShare: REVENUE_SURGE_SHARE,
        unit: "UZS",
      },
    },
    {
      subject: { key: "active_users", label: "Daily active" },
      days: completeDays(dau, today),
      bounds: { slumpShare: ACTIVE_SLUMP_SHARE, surgeShare: ACTIVE_SURGE_SHARE },
    },
  ];

  const found = replaySeries(series, window);
  const notes = await explainMovements(found);

  return {
    found,
    written: found
      .filter((movement) => notes.has(movementKey(movement)))
      .map((movement) => ({
        metricKey: movement.metricKey,
        date: movement.date,
        noteUz: notes.get(movementKey(movement))!,
      })),
  };
}
