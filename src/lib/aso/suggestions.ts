/**
 * Reduction behind the Suggestions section: for each platform and seed, the
 * newest crawl's terms with the genuinely new ones flagged.
 *
 * "New" means absent from the previous crawl, whenever that ran — comparing
 * against a fixed yesterday would mark the whole list new after any missed
 * day. The first crawl ever is a baseline, and baselines are not events, the
 * same convention listing tracking uses.
 */

export interface SuggestionRow {
  platform: string;
  seed: string;
  date: string;
  position: number;
  term: string;
}

export interface SeedSuggestions {
  platform: string;
  seed: string;
  date: string;
  terms: { term: string; position: number; isNew: boolean }[];
}

export function latestSuggestionSets(rows: SuggestionRow[]): SeedSuggestions[] {
  const bySeed = new Map<string, SuggestionRow[]>();
  for (const row of rows) {
    const key = `${row.platform}|${row.seed}`;
    bySeed.set(key, [...(bySeed.get(key) ?? []), row]);
  }

  const sets: SeedSuggestions[] = [];
  for (const seedRows of bySeed.values()) {
    const dates = [...new Set(seedRows.map((row) => row.date))].sort().reverse();
    const [latest, previous] = dates;

    const previousTerms = new Set(
      previous === undefined
        ? seedRows.map((row) => row.term) // first crawl: everything is baseline
        : seedRows.filter((row) => row.date === previous).map((row) => row.term),
    );

    const current = seedRows
      .filter((row) => row.date === latest)
      .sort((a, b) => a.position - b.position);

    sets.push({
      platform: current[0].platform,
      seed: current[0].seed,
      date: latest,
      terms: current.map((row) => ({
        term: row.term,
        position: row.position,
        isNew: !previousTerms.has(row.term),
      })),
    });
  }

  return sets.sort(
    (a, b) => a.seed.localeCompare(b.seed) || a.platform.localeCompare(b.platform),
  );
}
