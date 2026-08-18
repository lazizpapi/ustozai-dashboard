import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { Delta } from "@/lib/format";

/**
 * One figure in the overview strip.
 *
 * Deliberately not a card. At this density a row of rounded boxes is the
 * default dashboard look and it wastes the space that makes numbers
 * comparable; metrics sit in a hairline-divided row instead, which is what the
 * grid in MetricStrip provides.
 *
 * Direction is carried by the arrow glyph rather than by red and green. Colour
 * on this page means iOS or Android, and a third meaning for colour would
 * compete with that. The glyph is also legible to anyone who cannot separate
 * the two hues.
 */

interface MetricProps {
  /** Optional leading mark, e.g. a platform logo, shown beside the label. */
  icon?: React.ReactNode;
  label: string;
  value: string;
  /** Small qualifier under the value, e.g. "from 1,178 ratings". */
  detail?: string;
  change?: Delta;
  /**
   * Shown when the figure cannot be live, e.g. a download count that is always
   * at least a day old. Rendered so nobody reads yesterday as now.
   */
  asOf?: string;
  /**
   * Makes the whole metric a link to its own detail page.
   *
   * The affordance is deliberately quiet: an arrow that appears on hover
   * rather than permanent link styling. A strip where four of eight figures
   * are underlined and coloured stops reading as a set of numbers, and these
   * are numbers first.
   */
  href?: string;
}

function DeltaGlyph({ change }: { change: Delta }) {
  if (change.direction === "unknown") {
    return <span className="text-muted-foreground">{change.label}</span>;
  }
  if (change.direction === "flat") {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <Minus className="size-3" aria-hidden />
        {change.label}
      </span>
    );
  }

  const Arrow = change.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1">
      <Arrow className="size-3" aria-hidden />
      <span className="tnum">{change.label}</span>
    </span>
  );
}

export function Metric({
  icon,
  label,
  value,
  detail,
  change,
  asOf,
  href,
}: MetricProps) {
  const body = (
    <>
      <span
        className="text-muted-foreground flex items-center gap-1.5 text-xs"
      >
        {icon}
        {label}
        {href ? (
          <ArrowRight
            className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
            aria-hidden
          />
        ) : null}
      </span>

      <span
        className="tnum text-3xl leading-none font-medium tracking-tight"
      >
        {value}
      </span>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        {detail ? <span>{detail}</span> : null}
        {change ? (
          <span className="text-foreground/70">
            <DeltaGlyph change={change} />
          </span>
        ) : null}
        {/* Only present when the comparison did not reach a full week, so a
            four-day movement never gets read as a weekly one. */}
        {change?.spanLabel ? (
          <span className="text-muted-foreground/70">{change.spanLabel}</span>
        ) : null}
      </div>

      {asOf ? (
        <span className="text-muted-foreground/70 text-[11px]">{asOf}</span>
      ) : null}
    </>
  );

  const shell = "flex flex-col gap-1.5 px-5 py-4 first:pl-0";

  if (!href) return <div className={shell}>{body}</div>;

  return (
    <Link
      href={href}
      // group so the arrow can reveal on hover; the background shift is the
      // only other cue, which keeps the figure itself unstyled.
      className={cn(shell, "group hover:bg-muted/40 transition-colors")}
    >
      {body}
    </Link>
  );
}

/**
 * The hairline row.
 *
 * Collapses to two columns on small screens and one on the narrowest, with the
 * dividers following the wrap so the rhythm survives.
 *
 * `wide` carries eight figures as two rows of four rather than eight across.
 * Eight columns inside 1400px leaves about 170px each, which is not enough for
 * a six-digit follower count at full size, and shrinking the type to fit was
 * what made the strip feel cramped in the first place. The figures matter more
 * than the single line.
 */
export function MetricStrip({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        "divide-y sm:divide-y-0 sm:divide-x",
        // A border on whatever wrapped onto a new row, per breakpoint.
        "sm:[&>*:nth-child(n+3)]:border-t",
        wide
          ? "lg:[&>*]:border-t-0 lg:[&>*:nth-child(n+5)]:border-t"
          : "lg:[&>*]:border-t-0",
      )}
    >
      {children}
    </div>
  );
}
