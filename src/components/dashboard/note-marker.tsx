"use client";

import { ArrowDown, ArrowUp, Sparkles } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The mark on a tile whose figure moved and got explained.
 *
 * Quiet on purpose. A strip of eight metrics is read as a set of numbers, and
 * anything permanently loud on one of them breaks the row into a headline and
 * seven also-rans. So the mark is a small glyph in the corner, and the writing
 * behind it costs a click.
 *
 * A click, not a hover. Hover has no meaning on a phone, and the tile is often
 * a link: a note that appeared on hover would either fight the link's own hover
 * state or open while somebody was on their way to tapping through.
 */

export interface MetricNoteProp {
  noteUz: string;
  /** The day the movement happened, not the day the note was written. */
  movementDate: string;
  direction: "up" | "down";
  /** The movement in words, as the alert stated it. */
  magnitude: string;
}

export function NoteMarker({ note }: { note: MetricNoteProp }) {
  const Arrow = note.direction === "up" ? ArrowUp : ArrowDown;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`AI izohi: ${note.magnitude}`}
        className="text-muted-foreground/60 hover:text-foreground focus-visible:ring-ring rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Sparkles className="size-3.5" aria-hidden />
      </PopoverTrigger>

      <PopoverContent>
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Arrow
              className={cn(
                "size-3",
                note.direction === "up" ? "text-delta-up" : "text-delta-down",
              )}
              aria-hidden
            />
            <span className="tnum">{formatDay(note.movementDate)}</span>
            <span className="text-muted-foreground/70">{note.magnitude}</span>
          </div>

          <p className="text-sm leading-relaxed">{note.noteUz}</p>

          {/* Said plainly rather than implied by the glyph. Somebody acting on
              this should know it was written by a model reading the same
              dashboard they are looking at, and nothing beyond it. */}
          <p className="text-muted-foreground/70 border-t pt-2 text-[11px]">
            AI izohi, faqat dashboard ma&apos;lumotlariga asoslangan.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
