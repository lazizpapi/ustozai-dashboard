import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { TextAnalyzer } from "@/components/dashboard/text-analyzer";
import { load } from "@/app/load";
import {
  keywordSuggestionSets,
  latestKeywordRanks,
  type KeywordRow,
} from "@/lib/db/queries";
import { apostropheNote, formatDay, rankDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SeedSuggestions } from "@/lib/aso/suggestions";

export const dynamic = "force-dynamic";

/**
 * Search position per keyword.
 *
 * Terms the app does not rank for are shown, not hidden. They are the ones
 * worth acting on: an empty row for "matematika" is the finding, and filtering
 * it out would leave a table that only ever reports good news.
 */

function Movement({ row }: { row: KeywordRow }) {
  const change = rankDelta(row.position, row.previous);

  if (change.direction === "unknown") {
    return <span className="text-muted-foreground text-xs">no history yet</span>;
  }
  if (change.direction === "flat") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Minus className="size-3" aria-hidden />
        no change
      </span>
    );
  }

  const Arrow = change.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Arrow className="size-3" aria-hidden />
      <span className="tnum">{change.magnitude}</span>
    </span>
  );
}

/**
 * A tracked term, with its apostrophe named when that is the only thing
 * distinguishing it from another row. Without this the list shows ta'lim
 * twice and reads as a duplication bug rather than as two real spellings.
 */
function Keyword({ term }: { term: string }) {
  const note = apostropheNote(term);
  return (
    <span className="text-sm">
      {term}
      {note ? (
        <span className="text-muted-foreground/60 ml-1.5 text-xs">{note}</span>
      ) : null}
    </span>
  );
}

/**
 * One seed's suggestion lists, App Store and Google Play side by side.
 * "New" marks a term absent from the previous crawl — the signal the whole
 * section exists for — and it is a label, never a colour.
 */
function SuggestionSeed({ seed, sets }: { seed: string; sets: SeedSuggestions[] }) {
  const stores = [
    { key: "ios", label: "App Store" },
    { key: "android", label: "Google Play" },
  ];

  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-x-4 gap-y-1 py-2.5">
      <Keyword term={seed} />
      <div className="space-y-1">
        {stores.map((store) => {
          const set = sets.find((s) => s.platform === store.key);
          if (!set) return null;
          return (
            <div key={store.key} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <span className="text-muted-foreground w-20 shrink-0 text-xs">
                {store.label}
              </span>
              {set.terms.map((term) => (
                <span
                  key={term.term}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-xs",
                    term.isNew ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {term.term}
                  {term.isNew ? (
                    <span className="text-muted-foreground ml-1 font-normal">new</span>
                  ) : null}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function KeywordsPage() {
  const result = await load(async () => {
    const [ranks, suggestions] = await Promise.all([
      latestKeywordRanks("uz"),
      keywordSuggestionSets(),
    ]);
    return { ranks, suggestions };
  });

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { suggestions } = result.data;
  const trending = suggestions.find((set) => set.seed === "__trending__");
  const seedSets = suggestions.filter((set) => set.seed !== "__trending__");
  const seeds = [...new Set(seedSets.map((set) => set.seed))];

  const rows = [...result.data.ranks].sort((a, b) => {
    // Ranked terms first, best first; unranked watch terms after.
    if (a.position === null && b.position === null) return a.keyword.localeCompare(b.keyword);
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });

  const ranked = rows.filter((row) => row.position !== null).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Keywords"
        note={`App Store search, Uzbekistan. Ranking for ${ranked} of ${rows.length} tracked terms.`}
      />

      {rows.length === 0 ? (
        <Empty>No keyword readings yet. The daily run collects these.</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              key={row.keyword}
              className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 py-3"
            >
              <Keyword term={row.keyword} />

              <span className="tnum text-right text-sm">
                {row.position === null ? (
                  <span className="text-muted-foreground text-xs">
                    not in top {row.resultCount}
                  </span>
                ) : (
                  `#${row.position}`
                )}
              </span>

              <span className="w-24 text-right">
                <Movement row={row} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Suggestions appear once the daily run has crawled them. What the
        search box offers is demand the store has itself observed, so a new
        term under a seed we rank for is the earliest cheap signal of demand
        shifting.
      */}
      {seedSets.length > 0 ? (
        <Section
          title="Search suggestions"
          note={`what each store's search box offers for our tracked terms, ${formatDay(seedSets[0].date)}`}
        >
          <div className="divide-y">
            {seeds.map((seed) => (
              <SuggestionSeed
                key={seed}
                seed={seed}
                sets={seedSets.filter((set) => set.seed === seed)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {/*
        Trending renders only when Apple has something to say. Verified live
        2026-08-15: the endpoint answers for UZ with an empty list, so this
        section is absent today and appears the day Apple populates it.
      */}
      {trending && trending.terms.length > 0 ? (
        <Section title="Trending searches" note="App Store, Uzbekistan">
          <div className="flex flex-wrap gap-1.5">
            {trending.terms.map((term) => (
              <span key={term.term} className="rounded border px-1.5 py-0.5 text-xs">
                {term.term}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title="Text analyzer"
        note="keyword use in any pasted listing text; nothing is stored or sent"
      >
        <TextAnalyzer />
      </Section>

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        Positions come from the iTunes Search API, which is a close proxy for the
        App Store search tab rather than the same ranking engine. Treat the
        direction of travel as reliable and the exact number as approximate.
        Uzbek terms are tracked in both apostrophe forms because the two return
        different result sets and people type both.
      </p>
    </div>
  );
}
