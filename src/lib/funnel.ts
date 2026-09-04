/**
 * Where App Store downloads come from.
 *
 * Apple breaks every discovery event and every download down by the surface it
 * came from: a search result, the browse tabs, a link in another app, a link
 * on the web. The collectors have stored that breakdown since the first
 * analytics report landed, and nothing has ever read it, so the funnel on the
 * downloads page mixes all of them into one rate.
 *
 * That matters because the stages have different rates per source and the
 * blended number belongs to none of them. Somebody who searched the app by
 * name converts at a rate a browse impression never will, and a shift in the
 * mix moves the blended figure without any single source changing.
 *
 * The event constants live here rather than beside the parser because they are
 * the classification the funnel is built on, and this module has no server
 * dependencies, so a test can read them without the report reader coming too.
 */

export const IMPRESSION_EVENTS = ["impression", "impressions", "impressions_unique"];
export const TAP_EVENTS = ["tap", "taps"];
export const PAGE_VIEW_EVENTS = [
  "page_view",
  "page_views",
  "product_page_view",
  "product_page_views",
];

/**
 * Apple's source names in words.
 *
 * "Not attributed" rather than "unavailable", which is Apple's word and reads
 * on a dashboard as though the panel were broken. It means Apple did not say
 * where these came from, not that we failed to collect them.
 */
export const SOURCE_LABELS: Record<string, string> = {
  app_store_search: "App Store search",
  app_store_browse: "Browse and charts",
  app_referrer: "Links in other apps",
  web_referrer: "Web links",
  institutional: "Institutional purchase",
  unavailable: "Not attributed",
};

/**
 * A source name for a reader.
 *
 * Anything unlabelled is de-underscored rather than folded into a catch-all.
 * Apple publishes categories this dashboard has never seen, and reporting a
 * real channel as "not attributed" would be a worse answer than an ugly one.
 */
export function sourceLabel(source: string): string {
  const known = SOURCE_LABELS[source];
  if (known) return known;

  const words = source.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not attributed";
}

export interface SourceFunnel {
  source: string;
  impressions: number;
  taps: number;
  pageViews: number;
  firstTimeDownloads: number;
}

interface DiscoveryRow {
  event: string;
  source_type: string | null;
  units: number;
}

interface DownloadRow {
  source_type: string | null;
  units: number;
}

/** Apple's own word for a row it did not attribute to any surface. */
const UNATTRIBUTED = "unavailable";

const keyOf = (source: string | null): string => (source ?? "").trim() || UNATTRIBUTED;

/**
 * The four funnel stages, per source.
 *
 * Downloads are counted separately from the discovery events because they come
 * from a different report on a different schedule; a source can appear in one
 * and not the other, and a source that produced downloads is worth a row even
 * when its impressions have not landed yet.
 *
 * An event this does not recognise is skipped rather than guessed at. Apple
 * has renamed these columns before, and a new name silently added to
 * impressions would inflate the top of the funnel with no way to notice.
 */
export function funnelBySource(
  discovery: DiscoveryRow[],
  downloads: DownloadRow[],
): SourceFunnel[] {
  const bySource = new Map<string, SourceFunnel>();

  const rowFor = (source: string | null): SourceFunnel => {
    const key = keyOf(source);
    const existing = bySource.get(key);
    if (existing) return existing;

    const created: SourceFunnel = {
      source: key,
      impressions: 0,
      taps: 0,
      pageViews: 0,
      firstTimeDownloads: 0,
    };
    bySource.set(key, created);
    return created;
  };

  for (const entry of discovery) {
    const row = rowFor(entry.source_type);
    if (IMPRESSION_EVENTS.includes(entry.event)) row.impressions += entry.units;
    else if (TAP_EVENTS.includes(entry.event)) row.taps += entry.units;
    else if (PAGE_VIEW_EVENTS.includes(entry.event)) row.pageViews += entry.units;
  }

  for (const entry of downloads) {
    rowFor(entry.source_type).firstTimeDownloads += entry.units;
  }

  return (
    [...bySource.values()]
      /*
       * A source that did nothing at any stage is dropped. Apple sends rows
       * for surfaces with no activity at all, and a line of zeroes is not a
       * finding; it is the thing that teaches people to skip the table. A
       * source with impressions and no downloads stays, because that one is
       * often the most useful row on the page.
       */
      .filter(
        (row) =>
          row.impressions > 0 || row.taps > 0 || row.pageViews > 0 || row.firstTimeDownloads > 0,
      )
      // Ordered by what each source actually brought in. The question being
      // asked is which surface produces installs, so its answer leads.
      .sort(
        (a, b) =>
          b.firstTimeDownloads - a.firstTimeDownloads || b.impressions - a.impressions,
      )
  );
}
