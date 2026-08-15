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
}

const comparable = (value: string | string[] | null | undefined): string =>
  value === null || value === undefined ? "" : JSON.stringify(value);

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
        });
      }
    }
  }

  return changes.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}
