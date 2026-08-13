import "server-only";

import { APP_DOWNLOADS_REPORT, fetchAnalyticsReport } from "./analytics";
import { serviceClient } from "@/lib/db/client";
import { resolveAppIds } from "@/lib/db/persist";
import { IOS_APP_ID } from "@/lib/collectors/config";
import type { AscConfig } from "@/lib/env";

/**
 * Stores the Analytics download breakdown alongside the sales totals.
 *
 * Written with source='analytics' so it sits beside the 'sales' rows rather
 * than replacing them. The two answer different questions and have different
 * latency: sales gives a complete total a day earlier and stays the headline,
 * while this says where those downloads came from.
 */

export interface AnalyticsCollectResult {
  rows: number;
  dates: number;
  processingDate: string | null;
  segments: number;
}

export async function collectIosAnalytics(
  config: AscConfig,
  requestId: string,
): Promise<AnalyticsCollectResult> {
  const ids = await resolveAppIds();
  const appId = ids.get(`ios:${IOS_APP_ID}`);
  if (!appId) throw new Error("no apps row for the iOS app; run the seed migration");

  const { rows, processingDate, segments } = await fetchAnalyticsReport(
    config,
    requestId,
    APP_DOWNLOADS_REPORT,
  );

  const dates = new Set(rows.map((r) => r.date)).size;
  if (rows.length === 0) return { rows: 0, dates: 0, processingDate, segments };

  /*
   * Delete then insert, per date, rather than upsert.
   *
   * A restated instance can contain a different set of dimension combinations
   * than the one it supersedes: a source type that appeared yesterday may be
   * absent today. Upserting would leave those stale rows behind and inflate
   * the day's total. Clearing the dates this instance covers is the only way
   * for the newest instance to fully replace the older one.
   *
   * Scoped to source='analytics' so the sales rows are never touched.
   */
  const covered = [...new Set(rows.map((r) => r.date))];
  const { error: clearError } = await serviceClient()
    .from("ios_downloads_daily")
    .delete()
    .eq("app_id", appId)
    .eq("source", "analytics")
    .in("date", covered);
  if (clearError) throw new Error(`collectIosAnalytics clear: ${clearError.message}`);

  const payload = rows.map((r) => ({
    app_id: appId,
    date: r.date,
    country: r.country,
    download_type: r.downloadType,
    source_type: r.sourceType,
    device: r.device,
    units: r.units,
    source: "analytics" as const,
  }));

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await serviceClient()
      .from("ios_downloads_daily")
      .upsert(payload.slice(i, i + CHUNK), {
        onConflict: "app_id,date,country,download_type,source_type,device,source",
      });
    if (error) throw new Error(`collectIosAnalytics: ${error.message}`);
  }

  return { rows: payload.length, dates, processingDate, segments };
}
