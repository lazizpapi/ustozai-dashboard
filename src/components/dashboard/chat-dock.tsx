"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp, X } from "lucide-react";

import AIOrbFace from "@/components/smoothui/ai-orb-face";
import type { AIState } from "@/components/smoothui/ai-core";
import { pageSuggestions } from "@/lib/analyst/page-context";
import { cn } from "@/lib/utils";

/**
 * The analyst, docked in the corner of every page.
 *
 * It lives here rather than on a page of its own because the questions worth
 * asking occur while looking at something: you are on Market, you notice a
 * competitor moved, you ask. Mounted in the layout, so the conversation
 * survives navigating between pages.
 *
 * Two things carried over deliberately from the page it replaces. The
 * conversation is component state posted back each turn, so questions about
 * the company's numbers never reach the database and there is no history to
 * leak or expire. And every answer shows which data it read, because an agent
 * that can reach the whole database has to be auditable from the surface it
 * speaks through.
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
  get_revenue: "takings",
  get_active_users: "active users",
  get_instagram: "Instagram",
  get_metric_notes: "metric notes",
};

/** How long the orb holds its "done" face before settling back to idle. */
const SETTLE_MS = 1600;

/**
 * The narrowest possible markdown: bold, inline code, and bullets. The system
 * prompt asks for prose, so this covers what actually arrives rather than
 * pulling in a parser for syntax that never will.
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
  return (
    <div className="space-y-3">
      {text.split(/\n{2,}/).map((block, index) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
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

export function ChatDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState<AIState | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /*
   * The face is the status indicator, so it is derived rather than stored:
   * one source of truth for "what is happening" means the orb can never
   * disagree with the panel it sits in.
   */
  const state: AIState = busy
    ? "thinking"
    : (settling ?? (draft.trim().length > 0 ? "listening" : "idle"));

  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      // The history sent is the state before this turn. The new question rides
      // in its own field, so including it here too would show it twice.
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
          body: JSON.stringify({ question: trimmed, history, page: pathname }),
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
        setSettling(response.ok ? "done" : "error");
      } catch (error) {
        setTurns((previous) => [
          ...previous,
          {
            role: "assistant",
            content:
              error instanceof Error ? error.message : "Could not reach the analyst.",
            failed: true,
          },
        ]);
        setSettling("error");
      } finally {
        setBusy(false);
      }
    },
    [busy, pathname, turns],
  );

  return (
    <>
      {/*
        The button is the creature. Because the dock stays mounted, it keeps
        showing the thinking face while a question runs even with the panel
        closed, so the work is visible from anywhere on the dashboard.
      */}
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={open ? "Close the analyst" : "Ask the analyst"}
        aria-expanded={open}
        className={cn(
          "bg-background fixed right-5 bottom-5 z-40 flex size-14 items-center justify-center",
          "rounded-full border shadow-lg transition-transform sm:right-8",
          "hover:-translate-y-0.5 active:scale-95",
          open && "opacity-0 sm:opacity-100",
        )}
      >
        <AIOrbFace size={38} state={state} gaze={!open} />
      </button>

      {/* Mobile only: the sheet covers the page, so it needs a way out. */}
      {open ? (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/20 sm:hidden"
        />
      ) : null}

      <aside
        role="dialog"
        aria-label="Ask the analyst"
        aria-hidden={!open}
        className={cn(
          "bg-background fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l shadow-2xl",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
          <AIOrbFace size={26} state={state} gaze={false} />
          <div className="min-w-0">
            <p className="text-sm font-medium">Analyst</p>
            <p className="text-muted-foreground truncate text-xs">
              Reads the same data this dashboard shows
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground ml-auto transition-colors"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {turns.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Ask anything about the app&apos;s numbers.
              </p>
              <div className="flex flex-wrap gap-2">
                {pageSuggestions(pathname).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="hover:bg-muted rounded-full border px-3 py-1.5 text-left text-xs transition-colors"
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
                        {[
                          ...new Set(
                            turn.steps.map((s) => TOOL_LABEL[s.tool] ?? s.tool),
                          ),
                        ].join(", ")}
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
            <p className="text-muted-foreground mt-6 flex items-center gap-2 text-xs">
              <AIOrbFace size={20} state="thinking" gaze={false} />
              Reading the data
            </p>
          ) : null}

          <div ref={endRef} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
          className="flex shrink-0 items-end gap-2 border-t p-3"
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line. The convention
              // people already carry in from every other chat box.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            placeholder="Ask about downloads, competitors, keywords"
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
      </aside>
    </>
  );
}
