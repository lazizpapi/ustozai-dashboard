"use client";

import { useMemo, useState } from "react";

import { analyzeText } from "@/lib/aso/text-analyzer";
import { KEYWORDS } from "@/lib/collectors/config";
import { cn } from "@/lib/utils";

/**
 * Paste any listing text — a competitor's description, a draft of ours — and
 * see its keyword use against the terms we track. Entirely client-side: the
 * pasted text never leaves the page, is never stored, and costs no request.
 */
export function TextAnalyzer() {
  const [text, setText] = useState("");
  const analysis = useMemo(() => analyzeText(text, KEYWORDS), [text]);

  const percent = (density: number) => `${(density * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder="Paste a store description here — a competitor's, or a draft of ours."
        className={cn(
          "w-full rounded-md border bg-transparent px-3 py-2 text-sm",
          "placeholder:text-muted-foreground/60 focus-visible:outline-none",
          "focus-visible:ring-ring focus-visible:ring-1",
        )}
      />

      {analysis.wordCount > 0 ? (
        <div className="grid gap-6 text-sm sm:grid-cols-3">
          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">
              Tracked terms in this text
            </h3>
            <ul className="space-y-1">
              {analysis.tracked.map((match) => (
                <li key={match.keyword} className="flex items-baseline justify-between gap-2">
                  <span className={cn(match.count === 0 && "text-muted-foreground")}>
                    {match.keyword}
                  </span>
                  <span className="tnum text-muted-foreground text-xs">
                    {match.count === 0 ? "not used" : `×${match.count}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">
              Most used words · {analysis.wordCount} total
            </h3>
            <ul className="space-y-1">
              {analysis.words.slice(0, 10).map((stat) => (
                <li key={stat.term} className="flex items-baseline justify-between gap-2">
                  <span>{stat.term}</span>
                  <span className="tnum text-muted-foreground text-xs">
                    ×{stat.count} · {percent(stat.density)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">
              Repeated phrases
            </h3>
            {analysis.phrases.length > 0 ? (
              <ul className="space-y-1">
                {analysis.phrases.slice(0, 10).map((stat) => (
                  <li key={stat.term} className="flex items-baseline justify-between gap-2">
                    <span>{stat.term}</span>
                    <span className="tnum text-muted-foreground text-xs">×{stat.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs">
                No two-word phrase appears more than once.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
