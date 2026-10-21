import { localDate } from "./growth";

/**
 * Reductions for the market page, kept pure so the interesting logic is
 * pinned by tests instead of exercised for the first time in production.
 *
 * Both take rows the queries module fetched and answer one question each:
 * who moved in the chart, and who changed their store listing.
 */

export interface ChartAppRow {
  /** Tashkent calendar date the poll wrote, YYYY-MM-DD. */
  date: string;
  rank: number;
  storeId: string;
  name: string;
}

export interface ChartMover {
  rank: number;
  storeId: string;
  name: string;
  /** Positive = climbed. Null = no stored reading on the exact comparison day. */
  vsYesterday: number | null;
  vsWeek: number | null;
  /** Absent from yesterday's stored window — "entered the top 20", not "new to the store". */
  isNew: boolean;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's chart against yesterday's and last week's.
 *
 * Comparison days are exact. A gap in collection reads as "no comparison"
 * rather than silently comparing against whatever day happens to exist,
 * because a delta labelled "week" that actually spans three days is the kind
 * of quietly wrong number this dashboard is built to refuse.
 */
export function chartMovers(rows: ChartAppRow[]): {
  date: string | null;
  movers: ChartMover[];
} {
  if (rows.length === 0) return { date: null, movers: [] };

  const latest = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date);
  const byDay = (date: string) =>
    new Map(rows.filter((row) => row.date === date).map((row) => [row.storeId, row.rank]));

  const yesterday = byDay(shiftDate(latest, -1));
  const week = byDay(shiftDate(latest, -7));

  const movers = rows
    .filter((row) => row.date === latest)
    .sort((a, b) => a.rank - b.rank)
    .map((row) => {
      const rankYesterday = yesterday.get(row.storeId);
      const rankWeek = week.get(row.storeId);
      return {
        rank: row.rank,
        storeId: row.storeId,
        name: row.name,
        // A climb is rank going down, reported as positive movement.
        vsYesterday: rankYesterday === undefined ? null : rankYesterday - row.rank,
        vsWeek: rankWeek === undefined ? null : rankWeek - row.rank,
        isNew: yesterday.size > 0 && rankYesterday === undefined,
      };
    });

  return { date: latest, movers };
}

export interface ListingVersionRow {
  appId: string;
  appName: string;
  platform: string;
  fields: Record<string, string | string[] | null>;
  detectedAt: string;
}

export interface ListingChange {
  appId: string;
  appName: string;
  platform: string;
  detectedAt: string;
  changedFields: string[];
  /**
   * What shipped, when this change was a release.
   *
   * The field names alone say "changed version, release notes", which is true
   * and tells nobody anything. These two carry the values, and only when the
   * field in question actually moved: a screenshot swap reporting the version
   * it did not change would read as a release.
   *
   * Null on a store that publishes no notes. Google Play does have a "What is
   * new" section, but the listing parser does not read it, so an Android
   * release arrives with a version and nothing to quote.
   */
  version: string | null;
  releaseNotes: string | null;
}

const comparable = (value: string | string[] | null | undefined): string =>
  value === null || value === undefined ? "" : JSON.stringify(value);

/**
 * The listing fields in words, in one place.
 *
 * This map used to exist four times, once in each surface that renders a
 * change, and four copies of a vocabulary are four chances to drift.
 *
 * A field with no word here returns its own name rather than a blank. Apple
 * can add a field tomorrow, and "subtitle" is ugly and true where an empty
 * gap is neither.
 */
const FIELD_LABELS: Record<string, string> = {
  title: "name",
  description: "description",
  version: "version",
  releaseNotes: "release notes",
  screenshots: "screenshots",
  icon: "icon",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * One entry per app, per store, per day.
 *
 * Apple serves its listing from a CDN, and on 20 August different nodes
 * answered with different versions of Praktika within the same hours. The poll
 * recorded each faithfully, and the page then showed five releases where there
 * had been one, which was the most confusing thing on it.
 *
 * The surviving entry is the last reading of the day, because that is the
 * state the store actually ended the day in. The alternative rule, dropping a
 * version we have seen before, was rejected: it would silently hide a genuine
 * rollback, which is rare but real, and this rule cannot.
 *
 * Changed fields are unioned across the day rather than taken from the last
 * reading. A morning wording tweak followed by an evening release is one day
 * of activity and both halves are true.
 */
export function collapseSameDay(changes: ListingChange[]): ListingChange[] {
  const byDay = new Map<string, ListingChange>();

  // Oldest first, so the last write per key is the last reading of that day.
  for (const change of [...changes].sort((a, b) =>
    a.detectedAt.localeCompare(b.detectedAt),
  )) {
    const key = `${change.platform}:${change.appId}:${localDate(change.detectedAt)}`;
    const earlier = byDay.get(key);

    byDay.set(key, {
      ...change,
      changedFields: earlier
        ? [...new Set([...earlier.changedFields, ...change.changedFields])].sort()
        : change.changedFields,
      // The day's last non-null wins: a release followed by a screenshot swap
      // still shipped that version, and the swap carries none of its own.
      version: change.version ?? earlier?.version ?? null,
      releaseNotes: change.releaseNotes ?? earlier?.releaseNotes ?? null,
    });
  }

  return [...byDay.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

export interface ListingActivity {
  /** A build shipped: the version moved. */
  releases: ListingChange[];
  /** The store page moved and the version did not. ASO run in public. */
  edits: ListingChange[];
}

/**
 * Two lists, because these are two different events.
 *
 * "Ibrat Academy changed icon, release notes, version 2.4.1" means they
 * shipped. "Ibrat Academy changed description" means nobody shipped and they
 * reworded the page to win search. Rendered as the same grey sentence, a
 * reader has to decode which is which on every row, which is what made this
 * section hard to read.
 *
 * The test is the version field, matching the rule releaseMarkers already
 * applies to chart markers: an edit that leaves the version alone is
 * marketing, not a build.
 */
export function splitListingChanges(changes: ListingChange[]): ListingActivity {
  const collapsed = collapseSameDay(changes);

  return {
    releases: collapsed.filter((change) => change.version !== null),
    edits: collapsed.filter((change) => change.version === null),
  };
}

/**
 * How much of a release note fits beside a dated row before it stops being a
 * row. Generous enough for the two or three lines Apple notes actually run to,
 * short enough that a long changelog cannot take over the list.
 */
export const RELEASE_NOTE_CHARS = 240;

/**
 * Release notes, shortened to something that fits beside a dated row.
 *
 * Two transformations, both about the shape of the source. Apple returns the
 * notes as a bulleted list separated by blank lines, which renders as a column
 * of gaps in a list that is meant to scan; the whitespace is collapsed so it
 * reads as a sentence. And the cut lands on a word boundary, because a note
 * severed mid-word looks like a bug rather than like an excerpt.
 *
 * Whitespace-only notes return null rather than an empty string, so a caller
 * can ask "is there anything to show" instead of testing for blankness.
 */
export function releaseNoteExcerpt(notes: string | null, max: number): string | null {
  const flat = (notes ?? "").replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The new value of one field, but only when that field is among the changes. */
function changedText(
  fields: Record<string, string | string[] | null>,
  changed: string[],
  key: string,
): string | null {
  if (!changed.includes(key)) return null;
  const value = fields[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Consecutive stored versions per app, diffed into named changes.
 *
 * The first recorded version of an app is us starting to watch, not them
 * doing anything, so it never appears as a change. Null and absent field
 * states compare equal for the same reason they hash equal in listing.ts:
 * a parser gap must not read as competitor activity.
 */
export function listingDiffs(rows: ListingVersionRow[]): ListingChange[] {
  const byApp = new Map<string, ListingVersionRow[]>();
  for (const row of rows) {
    const key = `${row.platform}:${row.appId}`;
    byApp.set(key, [...(byApp.get(key) ?? []), row]);
  }

  const changes: ListingChange[] = [];
  for (const versions of byApp.values()) {
    const ordered = [...versions].sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1].fields;
      const current = ordered[i].fields;
      const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])];
      const changedFields = keys
        .filter((key) => comparable(previous[key]) !== comparable(current[key]))
        .sort();

      if (changedFields.length > 0) {
        changes.push({
          appId: ordered[i].appId,
          appName: ordered[i].appName,
          platform: ordered[i].platform,
          detectedAt: ordered[i].detectedAt,
          changedFields,
          version: changedText(current, changedFields, "version"),
          releaseNotes: changedText(current, changedFields, "releaseNotes"),
        });
      }
    }
  }

  return changes.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}
