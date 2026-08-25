import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";

import { Sparkline, type SparkPoint } from "@/components/dashboard/sparkline";
import { cn } from "@/lib/utils";
import type { Delta } from "@/lib/format";

/**
 * One figure in the metric strip.
 *
 * Not a card of its own. Metrics share a single bordered container and divide
 * it internally, so the figures stay on one baseline and remain comparable
 * across the row. A grid of separate boxes buys nothing here and costs the
 * alignment that makes a strip readable at a glance.
 *
 * Direction is carried by the arrow glyph, and tinted behind it. The glyph
 * leads because it survives greyscale, a colour-blind reader and a photocopy;
 * the tint follows because a strip of nine figures otherwise gives no way to
 * tell a good week from a bad one without reading every delta in turn.
 *
 * The tint is its own token pair, not the status triple. Those report whether
 * a system is healthy, and a rank slipping three places is not an incident.
 * Both pairs are measured against the card for 4.5:1 as text; see globals.css.
 */

interface MetricProps {
  /** Optional leading mark, e.g. a platform logo, shown beside the label. */
  icon?: React.ReactNode;
  label: string;
  value: string;
  /**
   * The unit the figure is counted in, set beside it.
   *
   * For money, which is the only figure here that is meaningless without one.
   * A follower count needs no unit and a rating would be worse for having one,
   * so this stays empty on almost every tile.
   *
   * Rendered after the number rather than before it: Uzbek writes the currency
   * after the amount, and a prefix would put three letters where the eye is
   * looking for the first digit.
   */
  unit?: string;
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
  /**
   * The last thirty readings, drawn small under the figure.
   *
   * Only for metrics whose history the page already holds. Fetching a series
   * per tile to decorate it would be paying in queries for something the
   * Rankings and Downloads pages already answer properly.
   */
  spark?: { points: SparkPoint[]; invert?: boolean };
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
    <span
      className={cn(
        "inline-flex items-center gap-1",
        change.direction === "up" ? "text-delta-up" : "text-delta-down",
      )}
    >
      <Arrow className="size-3" aria-hidden />
      <span className="tnum">{change.label}</span>
    </span>
  );
}

export function Metric({
  icon,
  label,
  value,
  unit,
  detail,
  change,
  asOf,
  href,
  spark,
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
        {/* Quieter and smaller than the figure. The amount is the subject; the
            currency only qualifies it, and at the same weight it competes. */}
        {unit ? (
          <span className="text-muted-foreground ml-1.5 text-base font-normal tracking-normal">
            {unit}
          </span>
        ) : null}
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

      {/* mt-auto so the curves in a row share a baseline even where one tile
          carries a detail line and its neighbour does not. */}
      {spark ? (
        <Sparkline
          points={spark.points}
          invert={spark.invert}
          className="mt-auto pt-2"
        />
      ) : null}
    </>
  );

  const shell = "flex h-full flex-col gap-1.5 px-4 py-3.5";

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
 * The metric strip: one bordered card, divided internally.
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
        "bg-card grid grid-cols-1 overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4",
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
