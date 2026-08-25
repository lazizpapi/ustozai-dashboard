import "server-only";

import { createAscToken } from "./jwt";
import { ReportGoneError, fetchDailySalesReport, type DailyProceeds, type DailyUnits } from "./sales";
import { serviceClient } from "@/lib/db/client";
import { resolveAppIds } from "@/lib/db/persist";
import { IOS_APP_ID } from "@/lib/collectors/config";
import type { AscConfig } from "@/lib/env";

/**
 * Pulls iOS download numbers and stores them.
 *
 * Two callers with different needs share this. The daily cron walks back a few
 * days: Apple occasionally republishes a day with corrected figures, and a
 * skipped or failed run would otherwise leave a permanent hole, so a short
 * overlapping window makes the series self-healing. The backfill route walks
 * back as far as Apple will serve, once.
 *
 * The long walk needs two behaviours the short one does not, which is why the
 * options exist rather than the daily path simply being given a bigger number.
 */

/** Yesterday is the newest day Apple can have closed. Four gives slack. */
const DEFAULT_LOOKBACK_DAYS = 4;

/**
 * Absolute bound on a single walk. Apple serves daily reports for 365 days and
 * returns 410 beyond that, so anything past ~370 is wasted requests; the extra
 * margin only exists so the 410 is observed rather than assumed.
 */
export const MAX_LOOKBACK_DAYS = 400;

/** Courtesy pacing so a long walk does not hammer Apple. */
const PACE_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export interface IosDownloadResult {
  daysFetched: number;
  daysWithData: number;
  daysFailed: number;
  rows: number;
  earliestDate: string | null;
  latestDate: string | null;
  /** Apple reported the archive ends here. An outcome, not a problem. */
  reachedRetentionLimit: boolean;
}

export interface CollectOptions {
  lookbackDays?: number;
  /**
   * Keep walking when a single day errors. Off for the daily run, where four
   * days matter equally and a failure should surface loudly. On for a
   * backfill, where a transient 500 on day 213 must not discard the other 419.
   */
  tolerateDayFailures?: boolean;
}

export async function collectIosDownloads(
  config: AscConfig,
  options: CollectOptions = {},
): Promise<IosDownloadResult> {
  const lookback = Math.min(
    options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    MAX_LOOKBACK_DAYS,
  );
  const tolerate = options.tolerateDayFailures ?? false;

  const ids = await resolveAppIds();
  const appId = ids.get(`ios:${IOS_APP_ID}`);
  if (!appId) throw new Error("no apps row for the iOS app; run the seed migration");

  // One token for the whole walk. Apple caps token lifetime at 20 minutes, so
  // re-mint if a long backfill outlives it.
  let token = await createAscToken(config);
  let tokenMintedAt = Date.now();
  const TOKEN_TTL_MS = 10 * 60 * 1000;

  const collected: DailyUnits[] = [];
  // Same report, read a second way. See fetchDailySalesReport.
  const earned: DailyProceeds[] = [];
  let daysWithData = 0;
  let daysFailed = 0;
  let reachedRetentionLimit = false;
  let walked = 0;

  for (let back = 1; back <= lookback; back += 1) {
    if (Date.now() - tokenMintedAt > TOKEN_TTL_MS) {
      token = await createAscToken(config);
      tokenMintedAt = Date.now();
    }

    walked += 1;
    try {
      const report = await fetchDailySalesReport(
        config,
        isoDaysAgo(back),
        IOS_APP_ID,
        token,
      );

      if (report === null) {
        // No report for that date. Ordinary: the most recent day is usually
        // not closed yet, and days before release never existed.
        continue;
      }

      daysWithData += 1;
      collected.push(...report.units);
      earned.push(...report.proceeds);
    } catch (error) {
      // Apple stating where the archive ends. Everything older is gone too, so
      // stop walking, and do not count it against the run.
      if (error instanceof ReportGoneError) {
        reachedRetentionLimit = true;
        walked -= 1;
        break;
      }
      if (!tolerate) throw error;
      daysFailed += 1;
    }

    if (back < lookback) await sleep(PACE_MS);
  }

  const dates = collected.map((entry) => entry.date).sort();
  const summary: IosDownloadResult = {
    daysFetched: walked,
    daysWithData,
    daysFailed,
    rows: 0,
    earliestDate: dates[0] ?? null,
    latestDate: dates.at(-1) ?? null,
    reachedRetentionLimit,
  };

  if (collected.length === 0) return summary;

  const rows = collected.map((entry) => ({
    app_id: appId,
    date: entry.date,
    country: entry.country,
    download_type: entry.downloadType,
    source_type: "all",
    device: "all",
    units: entry.units,
    source: "sales" as const,
  }));

  // Chunked: a year of per-country rows is well past what one request should
  // carry, and Supabase will reject an oversized body rather than split it.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await serviceClient()
      .from("ios_downloads_daily")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "app_id,date,country,download_type,source_type,device,source",
      });
    if (error) throw new Error(`collectIosDownloads: ${error.message}`);
  }

  await saveProceeds(appId, earned);

  return { ...summary, rows: rows.length };
}

/**
 * Developer proceeds for the days just walked.
 *
 * Usually nothing, and that is the expected state rather than a fault: Ustoz
 * AI is a free download that takes payment through Payme and Click, so Apple
 * owes nothing for it and parseProceedsTsv drops the zero rows. The table
 * fills by itself the day an in-app purchase is sold, without anyone
 * remembering to switch a collector on.
 */
async function saveProceeds(appId: string, earned: DailyProceeds[]): Promise<void> {
  if (earned.length === 0) return;

  const rows = earned.map((entry) => ({
    app_id: appId,
    date: entry.date,
    country: entry.country,
    units: entry.units,
    proceeds: entry.proceeds,
    currency: entry.currency,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await serviceClient()
      .from("ios_proceeds_daily")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "app_id,date,country,currency",
      });
    if (error) throw new Error(`saveProceeds: ${error.message}`);
  }
}
