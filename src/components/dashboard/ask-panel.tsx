"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The chat with the analyst.
 *
 * Two decisions worth stating. The conversation lives here in component state
 * and is posted back each turn: questions about the company's numbers never
 * touch the database, so there is no chat history to leak, expire, or explain
 * to anyone. It resets on reload, which is the honest trade.
 *
 * And every answer shows which data it read. An agent that can reach the whole
 * database has to be auditable from the page, or it is just a confident voice.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: { tool: string; args: Record<string, unknown> }[];
  failed?: boolean;
}

/** Human names for the tools, so the trace reads as English. */
const TOOL_LABEL: Record<string, string> = {
  get_downloads: "downloads",
  get_market: "competitors",
  get_chart: "the chart",
  get_conversion_funnel: "the conversion funnel",
  get_keywords: "keywords",
  get_reviews: "reviews",
  get_audience: "audience",
  get_growth: "growth",
  get_listing_changes: "listing changes",
  get_latest_report: "the last report",
  get_collector_health: "collector health",
};

const SUGGESTIONS = [
  "How are we doing this week?",
  "Which competitor is growing fastest?",
  "What are people complaining about in reviews?",
  "Why is our chart rank lower than apps with fewer installs?",
];

/**
 * The narrowest possible markdown: bold, inline code, and bullets. The system
 * prompt asks for prose, so this covers what it actually emits rather than
 * pulling in a parser to handle syntax that will never arrive.
 */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^\s*[-*•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

export function AskPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    // The history sent is the state before this turn — the new question rides
    // in its own field, so it must not also appear in the history or the model
    // sees it twice.
    const history = turns
      .filter((turn) => !turn.failed)
      .map((turn) => ({ role: turn.role, content: turn.content }));

    setTurns((previous) => [...previous, { role: "user", content: trimmed }]);
    setDraft("");
    setBusy(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });
      const data = await response.json();

      setTurns((previous) => [
        ...previous,
        response.ok
          ? { role: "assistant", content: data.answer, steps: data.steps }
          : {
              role: "assistant",
              content: data.error ?? "Something went wrong.",
              failed: true,
            },
      ]);
    } catch (error) {
      setTurns((previous) => [
        ...previous,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Could not reach the analyst.",
          failed: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {turns.length === 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Ask anything about the app&apos;s numbers. It reads the same data the
            rest of this dashboard shows.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="hover:bg-muted rounded-full border px-3 py-1.5 text-xs transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <p key={index} className="text-sm font-medium">
                {turn.content}
              </p>
            ) : (
              <div key={index} className="space-y-2">
                {turn.steps && turn.steps.length > 0 ? (
                  <p className="text-muted-foreground/70 text-xs">
                    Read{" "}
                    {[...new Set(turn.steps.map((s) => TOOL_LABEL[s.tool] ?? s.tool))].join(
                      ", ",
                    )}
                  </p>
                ) : null}
                <div
                  className={cn(
                    "text-sm leading-relaxed",
                    turn.failed && "text-muted-foreground italic",
                  )}
                >
                  {turn.failed ? turn.content : <Answer text={turn.content} />}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {busy ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Reading the data…
        </p>
      ) : null}

      <div ref={endRef} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        className="bg-background sticky bottom-4 flex items-end gap-2 rounded-lg border p-2"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+enter breaks the line — the convention people
            // already have from every other chat box.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          placeholder="Ask about downloads, competitors, keywords, reviews…"
          className="placeholder:text-muted-foreground/60 max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          aria-label="Send"
          className={cn(
            "bg-foreground text-background flex size-8 shrink-0 items-center justify-center rounded-md",
            "transition-opacity disabled:opacity-30",
          )}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
