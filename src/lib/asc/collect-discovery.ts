import "server-only";

import { DISCOVERY_REPORT, fetchAnalyticsReport } from "./analytics";
import { parseDiscoveryTsv, type DiscoveryRow } from "./discovery";
import { serviceClient } from "@/lib/db/client";
import { resolveAppIds } from "@/lib/db/persist";
import { IOS_APP_ID } from "@/lib/collectors/config";
import type { AscConfig } from "@/lib/env";

/**
 * Stores the discovery and engagement counts that sit above downloads.
 *
 * Deliberately the same shape as collect-analytics.ts rather than shared with
 * it. The two write different tables with different dimension keys, and the
 * one thing they genuinely have in common, the instance walk and the
 * newest-instance rule, already lives in fetchAnalyticsReport.
 */

export interface DiscoveryCollectResult {
  rows: number;
  dates: number;
  processingDate: string | null;
  segments: number;
}

export async function collectIosDiscovery(
  config: AscConfig,
  requestId: string,
): Promise<DiscoveryCollectResult> {
  const ids = await resolveAppIds();
  const appId = ids.get(`ios:${IOS_APP_ID}`);
  if (!appId) throw new Error("no apps row for the iOS app; run the seed migration");

  const { rows, processingDate, segments } = await fetchAnalyticsReport<DiscoveryRow>(
    config,
    requestId,
    DISCOVERY_REPORT,
    parseDiscoveryTsv,
  );

  const dates = new Set(rows.map((r) => r.date)).size;
  if (rows.length === 0) return { rows: 0, dates: 0, processingDate, segments };

  /*
   * Delete then insert, per date, for the same reason as the downloads
   * analytics: a restated instance can carry a different set of dimension
   * combinations than the one it supersedes, so upserting alone would leave
   * the rows that vanished behind and inflate the day.
   */
  const covered = [...new Set(rows.map((r) => r.date))];
  const { error: clearError } = await serviceClient()
    .from("ios_discovery_daily")
    .delete()
    .eq("app_id", appId)
    .in("date", covered);
  if (clearError) throw new Error(`collectIosDiscovery clear: ${clearError.message}`);

  const payload = rows.map((r) => ({
    app_id: appId,
    date: r.date,
    country: r.country,
    event: r.event,
    page_type: r.pageType,
    source_type: r.sourceType,
    device: r.device,
    units: r.units,
  }));

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await serviceClient()
      .from("ios_discovery_daily")
      .upsert(payload.slice(i, i + CHUNK), {
        onConflict: "app_id,date,country,event,page_type,source_type,device",
      });
    if (error) throw new Error(`collectIosDiscovery: ${error.message}`);
  }

  return { rows: payload.length, dates, processingDate, segments };
}
