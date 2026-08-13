import "server-only";

import { gunzipSync } from "node:zlib";

import { createAscToken } from "./jwt";
import type { AscConfig } from "@/lib/env";

/**
 * Apple's Analytics reports: where downloads actually came from.
 *
 * This is the difference between "108 downloads yesterday" and "108 downloads,
 * 71 of them from App Store search". Sales and Trends gives the total a day
 * earlier and stays the headline number; this adds the breakdown underneath.
 *
 * Four levels deep, and each one matters:
 *
 *   request -> reports -> instances -> segments
 *
 * A report is a definition. An instance is one delivery of that report for one
 * granularity. A segment is a physical chunk of an instance, and a single
 * instance is routinely split across several, so fetching only the first one
 * silently loses part of the day.
 *
 * The rule that prevents wrong numbers: Apple restates a date as late events
 * arrive, publishing a fresh instance with a newer processingDate that
 * supersedes the older one. Their documentation is explicit that these must
 * not be merged. Summing two instances for the same date double counts it.
 */

const BASE = "https://api.appstoreconnect.apple.com";

/** Report names, as they appear in the API listing. */
export const APP_DOWNLOADS_REPORT = "App Downloads Detailed";
export const DISCOVERY_REPORT = "App Store Discovery and Engagement Detailed";

export interface AnalyticsRow {
  date: string;
  country: string;
  downloadType: string;
  sourceType: string;
  device: string;
  units: number;
}

interface ApiListResponse<T> {
  data?: T[];
}

interface NamedResource {
  id: string;
  attributes?: { name?: string; granularity?: string; processingDate?: string };
}

interface SegmentResource {
  id: string;
  attributes?: { url?: string; sizeInBytes?: number };
}

/**
 * Apple's human-readable labels, mapped onto the values already stored by the
 * sales collector so the two sources stay directly comparable.
 */
export function normaliseDownloadType(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.startsWith("first")) return "first_time";
  if (value.startsWith("redownload")) return "redownload";
  if (value.includes("update")) return "update";
  if (value.startsWith("restore")) return "restore";
  return value.replace(/\s+/g, "_") || "unknown";
}

export function normaliseSourceType(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.includes("search")) return "app_store_search";
  if (value.includes("browse")) return "app_store_browse";
  if (value.includes("app referrer")) return "app_referrer";
  if (value.includes("web referrer")) return "web_referrer";
  if (value.includes("app clip")) return "app_clip";
  if (value.includes("institutional")) return "institutional";
  if (!value || value === "unavailable") return "unavailable";
  return value.replace(/\s+/g, "_");
}

/**
 * Parse one segment's TSV.
 *
 * Columns are read by name, never by position: Apple states outright that
 * column order can change between deliveries, and the sales parser was written
 * the same way for the same reason.
 */
export function parseAnalyticsTsv(tsv: string): AnalyticsRow[] {
  const lines = tsv.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);

  const idxDate = at("Date");
  const idxCounts = at("Counts");
  const idxTerritory = at("Territory");
  const idxDownload = at("Download Type");
  const idxSource = at("Source Type");
  const idxDevice = at("Device");

  if (idxDate < 0 || idxCounts < 0) {
    throw new Error(
      `analytics report is missing Date or Counts; got: ${header.join(", ")}`,
    );
  }

  const totals = new Map<string, AnalyticsRow>();

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const units = Number.parseInt(cells[idxCounts] ?? "", 10);
    if (!Number.isFinite(units)) continue;

    const date = (cells[idxDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    // Territory is absent from the Standard variant, where every row is the
    // worldwide total. Recording that as a country would be wrong, so it gets
    // its own marker rather than being guessed at.
    const country =
      idxTerritory >= 0 ? (cells[idxTerritory] ?? "").trim().toLowerCase() : "all";
    const downloadType =
      idxDownload >= 0 ? normaliseDownloadType(cells[idxDownload] ?? "") : "all";
    const sourceType =
      idxSource >= 0 ? normaliseSourceType(cells[idxSource] ?? "") : "all";
    const device = idxDevice >= 0 ? (cells[idxDevice] ?? "").trim().toLowerCase() : "all";

    // The detailed report breaks rows down further than we store (app version,
    // page title, campaign), so several rows collapse into one of ours.
    const key = `${date}|${country}|${downloadType}|${sourceType}|${device}`;
    const existing = totals.get(key);
    if (existing) existing.units += units;
    else totals.set(key, { date, country, downloadType, sourceType, device, units });
  }

  return [...totals.values()];
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`analytics ${path} ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

/**
 * Newest instance per granularity.
 *
 * Apple republishes a date with a later processingDate when corrections or
 * late events arrive. Taking only the newest, rather than every instance, is
 * what stops a restated day being counted twice.
 */
export function newestInstance(instances: NamedResource[]): NamedResource | null {
  const daily = instances.filter((i) => i.attributes?.granularity === "DAILY");
  const pool = daily.length > 0 ? daily : instances;
  if (pool.length === 0) return null;

  return pool.reduce((newest, candidate) =>
    (candidate.attributes?.processingDate ?? "") > (newest.attributes?.processingDate ?? "")
      ? candidate
      : newest,
  );
}

export interface AnalyticsFetchResult<Row = AnalyticsRow> {
  rows: Row[];
  processingDate: string | null;
  segments: number;
}

/**
 * Pull the newest daily instance of a report and flatten every segment.
 *
 * Returns no rows rather than throwing when Apple has not produced an instance
 * yet, which is the normal state for the first day or two after the ongoing
 * request is created.
 *
 * The row parser is a parameter because everything above it, the four-level
 * walk and the newest-instance rule, is identical for every report Apple
 * publishes; only the TSV columns differ. Passing the parser in keeps that
 * traversal in one place rather than copied per report, which matters because
 * the restatement rule is the easiest thing here to get subtly wrong.
 */
export async function fetchAnalyticsReport<Row = AnalyticsRow>(
  config: AscConfig,
  requestId: string,
  reportName: string,
  parseTsv: (tsv: string) => Row[] = parseAnalyticsTsv as unknown as (tsv: string) => Row[],
): Promise<AnalyticsFetchResult<Row>> {
  const token = await createAscToken(config);

  const reports = await apiGet<ApiListResponse<NamedResource>>(
    `/v1/analyticsReportRequests/${requestId}/reports?limit=200`,
    token,
  );
  const report = (reports.data ?? []).find((r) => r.attributes?.name === reportName);
  if (!report) throw new Error(`analytics report "${reportName}" not offered`);

  const instances = await apiGet<ApiListResponse<NamedResource>>(
    `/v1/analyticsReports/${report.id}/instances?limit=200`,
    token,
  );
  const instance = newestInstance(instances.data ?? []);
  if (!instance) return { rows: [], processingDate: null, segments: 0 };

  const segments = await apiGet<ApiListResponse<SegmentResource>>(
    `/v1/analyticsReportInstances/${instance.id}/segments?limit=200`,
    token,
  );

  const rows: Row[] = [];
  for (const segment of segments.data ?? []) {
    const url = segment.attributes?.url;
    if (!url) continue;

    // Segment URLs are pre-signed, so no auth header, and adding one can make
    // the storage host reject the request.
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`analytics segment ${segment.id} download ${response.status}`);
    }

    const raw = Buffer.from(await response.arrayBuffer());
    // Segments are gzipped, same as the sales reports.
    const tsv = gunzipSync(raw).toString("utf8");
    rows.push(...parseTsv(tsv));
  }

  return {
    rows,
    processingDate: instance.attributes?.processingDate ?? null,
    segments: (segments.data ?? []).length,
  };
}
