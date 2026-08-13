import "server-only";

import { normaliseSourceType } from "./analytics";

/**
 * App Store Discovery and Engagement: the top of the funnel.
 *
 * Downloads alone cannot say whether a good week came from more people finding
 * the app or from more of the same people deciding to install it. Those two
 * call for opposite responses, and impressions and product page views are what
 * separate them.
 *
 * A note on trust. Unlike every other parser here, this one was written before
 * a single real payload existed: the ongoing analytics request lists the report
 * but Apple had not yet produced an instance. The column names below are
 * Apple's documented ones, not observed ones. That is why the required set is
 * checked explicitly and the failure echoes the whole header. When the first
 * instance lands this either works or produces a message that names exactly
 * what to change, which is the only honest way to ship an unverified parser.
 */

export interface DiscoveryRow {
  date: string;
  country: string;
  event: string;
  pageType: string;
  sourceType: string;
  device: string;
  units: number;
}

/**
 * Apple's event labels, lowercased and underscored, but deliberately not
 * mapped onto a fixed vocabulary.
 *
 * Whitelisting would mean guessing the exact strings, and a guess that misses
 * silently drops the row. An unrecognised event lands in the table under its
 * own name instead, where it is visible and can be classified later.
 */
export function normaliseEvent(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_") || "unknown";
}

/** Matches the funnel query. Kept here so the two cannot drift apart. */
export const IMPRESSION_EVENTS = ["impression", "impressions", "impressions_unique"];
export const PAGE_VIEW_EVENTS = ["product_page_view", "product_page_views"];

export function parseDiscoveryTsv(tsv: string): DiscoveryRow[] {
  const lines = tsv.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t").map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);

  const idxDate = at("Date");
  const idxEvent = at("Event");
  const idxCounts = at("Counts");
  const idxTerritory = at("Territory");
  const idxPageType = at("Page Type");
  const idxSource = at("Source Type");
  const idxDevice = at("Device");

  /*
   * Loud on purpose, and it names the header.
   *
   * Without Event there is no funnel, only an undifferentiated pile of counts,
   * and quietly returning those would put a number on the dashboard that looks
   * like impressions and is not. The echoed header turns a wrong guess about
   * Apple's column names into a one line fix rather than an investigation.
   */
  if (idxDate < 0 || idxEvent < 0 || idxCounts < 0) {
    throw new Error(
      `discovery report is missing Date, Event or Counts; got: ${header.join(", ")}`,
    );
  }

  const totals = new Map<string, DiscoveryRow>();

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");

    /*
     * Counts only. Unique Counts is in this report and is deliberately left
     * there: unique device counts are not additive, and the rows below collapse
     * several of Apple's dimensions into one of ours by summing. A summed
     * unique count would be confidently wrong rather than obviously missing.
     */
    const units = Number.parseInt(cells[idxCounts] ?? "", 10);
    if (!Number.isFinite(units)) continue;

    const date = (cells[idxDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const event = normaliseEvent(cells[idxEvent] ?? "");

    // Absent dimensions mean the row is already the total across them, which
    // is a different statement from a country or device we failed to read.
    const country =
      idxTerritory >= 0 ? (cells[idxTerritory] ?? "").trim().toLowerCase() : "all";
    const pageType =
      idxPageType >= 0 ? normaliseEvent(cells[idxPageType] ?? "") : "all";
    const sourceType =
      idxSource >= 0 ? normaliseSourceType(cells[idxSource] ?? "") : "all";
    const device = idxDevice >= 0 ? (cells[idxDevice] ?? "").trim().toLowerCase() : "all";

    const key = `${date}|${country}|${event}|${pageType}|${sourceType}|${device}`;
    const existing = totals.get(key);
    if (existing) existing.units += units;
    else totals.set(key, { date, country, event, pageType, sourceType, device, units });
  }

  return [...totals.values()];
}
