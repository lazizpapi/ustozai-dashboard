import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Empty, PageHeader } from "@/components/dashboard/page-header";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { latestKeywordRanks, type KeywordRow } from "@/lib/db/queries";
import { rankDelta } from "@/lib/format";

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

export default async function KeywordsPage() {
  const result = await load(() => latestKeywordRanks("uz"));

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const rows = [...result.data].sort((a, b) => {
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
              <span className="text-sm">{row.keyword}</span>

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
