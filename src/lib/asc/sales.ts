import "server-only";

import { gunzipSync } from "node:zlib";

import { createAscToken } from "./jwt";
import type { AscConfig } from "@/lib/env";

/**
 * Sales and Trends daily report: the simplest path to real iOS install counts.
 *
 * Two behaviours here are easy to get wrong and both are load-bearing.
 *
 * First, a 404 from this endpoint means "no data for that date", not an error.
 * Apple returns it for days before the app existed, for days not yet closed,
 * and for days with genuinely zero activity. Treating it as a failure would
 * light up the health panel every morning.
 *
 * Second, the body is gzip bytes with a Content-Type of application/a-gzip and
 * no Content-Encoding header, so fetch does not decompress it for us. It has to
 * be gunzipped by hand.
 */

const BASE = "https://api.appstoreconnect.apple.com/v1/salesReports";

/**
 * Thrown when Apple has aged a report out.
 *
 * Distinct from the 404 "no data for that date" case, and not a failure: it is
 * Apple stating where the archive ends. Measured against this account, day
 * minus 365 returns 200 and day minus 366 returns 410 with "Daily reports are
 * available for 365 days". A backfill should stop on it, because everything
 * older is gone too, and should not report it as an error.
 */
export class ReportGoneError extends Error {
  constructor(readonly date: string) {
    super(`sales report for ${date} is past Apple's retention window`);
    this.name = "ReportGoneError";
  }
}

export interface DailyUnits {
  date: string;
  country: string;
  downloadType: "download" | "update";
  units: number;
}

export interface DailyProceeds {
  date: string;
  country: string;
  /** Units that actually earned money, not total downloads. */
  units: number;
  /** Already multiplied out. See parseProceedsTsv. */
  proceeds: number;
  currency: string;
}

/**
 * Classify Apple's Product Type Identifier.
 *
 * Identifiers beginning with 7 are updates. In-app purchases (the 3 and IA
 * families) are not app installs and are excluded outright. Everything else in
 * the 1 and F families is a first download or purchase.
 *
 * This is a coarse split. The authoritative first-time versus redownload
 * breakdown comes from the Analytics App Downloads report, which is why
 * ios_downloads_daily keeps a `source` column rather than letting one overwrite
 * the other.
 */
function classify(productTypeId: string): DailyUnits["downloadType"] | null {
  const id = productTypeId.trim().toUpperCase();
  if (id.startsWith("IA") || id.startsWith("3") || id.startsWith("FI")) return null;
  if (id.startsWith("7")) return "update";
  return "download";
}

export function parseSalesTsv(tsv: string, appleId: string): DailyUnits[] {
  const lines = tsv.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map((h) => h.trim());
  const column = (name: string) => header.indexOf(name);

  // Apple has warned that column order can change, so index by name.
  const idxUnits = column("Units");
  const idxCountry = column("Country Code");
  const idxDate = column("Begin Date");
  const idxType = column("Product Type Identifier");
  const idxAppleId = column("Apple Identifier");

  if (idxUnits < 0 || idxCountry < 0 || idxDate < 0 || idxType < 0) {
    throw new Error(
      `sales report is missing expected columns; got: ${header.join(", ")}`,
    );
  }

  const totals = new Map<string, DailyUnits>();

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (idxAppleId >= 0 && cells[idxAppleId]?.trim() !== appleId) continue;

    const downloadType = classify(cells[idxType] ?? "");
    if (downloadType === null) continue;

    const units = Number.parseInt(cells[idxUnits] ?? "", 10);
    if (!Number.isFinite(units)) continue;

    const country = (cells[idxCountry] ?? "").trim().toLowerCase();
    const date = normaliseDate(cells[idxDate] ?? "");
    if (!country || !date) continue;

    const key = `${date}|${country}|${downloadType}`;
    const existing = totals.get(key);
    if (existing) existing.units += units;
    else totals.set(key, { date, country, downloadType, units });
  }

  return [...totals.values()];
}

/**
 * Developer proceeds out of the same report the unit counts come from.
 *
 * Apple states Developer Proceeds PER UNIT, so a row is worth Units times
 * that figure. Reading the column as a row total understates a day by exactly
 * the number of units sold. The UstozAI transactions endpoint carries the same
 * shape and was misread the same way, which is why this is laboured here
 * rather than left to the reader.
 *
 * Deliberately not filtered through classify(). That function drops in-app
 * purchases because they are not installs, and in-app purchases are precisely
 * where the money is: filtering the same way would leave this permanently
 * empty for any app that is free to download.
 *
 * Rows earning nothing are skipped rather than stored as zero. Ustoz AI is a
 * free download monetised outside the App Store, so keeping them would write
 * a few thousand rows a year that all say no money changed hands, and an
 * empty table is the more honest way to say the same thing.
 */
export function parseProceedsTsv(tsv: string, appleId: string): DailyProceeds[] {
  const lines = tsv.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map((h) => h.trim());
  const column = (name: string) => header.indexOf(name);

  const idxUnits = column("Units");
  const idxProceeds = column("Developer Proceeds");
  const idxCurrency = column("Currency of Proceeds");
  const idxCountry = column("Country Code");
  const idxDate = column("Begin Date");
  const idxAppleId = column("Apple Identifier");

  // A report without the proceeds columns is not a failure. Apple varies the
  // shape by report subtype, and the unit counts are parsed separately.
  if (idxProceeds < 0 || idxUnits < 0 || idxCountry < 0 || idxDate < 0) return [];

  const totals = new Map<string, DailyProceeds>();

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (idxAppleId >= 0 && cells[idxAppleId]?.trim() !== appleId) continue;

    const perUnit = Number.parseFloat(cells[idxProceeds] ?? "");
    const units = Number.parseInt(cells[idxUnits] ?? "", 10);
    if (!Number.isFinite(perUnit) || !Number.isFinite(units)) continue;
    if (perUnit === 0 || units === 0) continue;

    const country = (cells[idxCountry] ?? "").trim().toLowerCase();
    const date = normaliseDate(cells[idxDate] ?? "");
    const currency = (cells[idxCurrency] ?? "").trim().toUpperCase() || "USD";
    if (!country || !date) continue;

    const key = date + "|" + country + "|" + currency;
    const existing = totals.get(key);
    if (existing) {
      existing.units += units;
      existing.proceeds += units * perUnit;
    } else {
      totals.set(key, { date, country, units, proceeds: units * perUnit, currency });
    }
  }

  // Rounded once at the end. Money in floating point drifts, and four places
  // keeps every real currency's minor unit intact.
  return [...totals.values()].map((entry) => ({
    ...entry,
    proceeds: Math.round(entry.proceeds * 10000) / 10000,
  }));
}

/** Apple writes Begin Date as MM/DD/YYYY in these reports. */
function normaliseDate(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

/**
 * Returns null when Apple has no report for that date.
 *
 * `token` lets a caller mint one JWT and reuse it across a long walk. A
 * backfill covering a year would otherwise sign four hundred of them for no
 * reason. Omit it and this signs its own, which is what the daily path does.
 */
export async function fetchDailySales(
  config: AscConfig,
  date: string,
  appleId: string,
  token?: string,
): Promise<DailyUnits[] | null> {
  const report = await fetchDailySalesReport(config, date, appleId, token);
  return report ? report.units : null;
}

/**
 * The whole report, parsed both ways.
 *
 * One request, two readings. Proceeds and unit counts come out of the same
 * TSV, and fetching it twice to get them would double the calls against a
 * rate limited endpoint for no gain.
 */
export async function fetchDailySalesReport(
  config: AscConfig,
  date: string,
  appleId: string,
  token?: string,
): Promise<{ units: DailyUnits[]; proceeds: DailyProceeds[] } | null> {
  token ??= await createAscToken(config);
  const params = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": config.ASC_VENDOR_NUMBER,
    "filter[reportDate]": date,
    "filter[version]": "1_1",
  });

  const response = await fetch(`${BASE}?${params}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/a-gzip" },
  });

  if (response.status === 404) return null; // No data for this date. Normal.
  if (response.status === 410) throw new ReportGoneError(date); // Past retention.
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`salesReports ${response.status}: ${detail.slice(0, 300)}`);
  }

  const gzipped = Buffer.from(await response.arrayBuffer());
  const tsv = gunzipSync(gzipped).toString("utf8");
  return { units: parseSalesTsv(tsv, appleId), proceeds: parseProceedsTsv(tsv, appleId) };
}
