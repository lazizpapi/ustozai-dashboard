import { ArrowDown, ArrowUp, Minus } from "lucide-react";

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
   * Tighter type and padding, for strips that carry eight figures instead of
   * four. Only the scale changes; the anatomy stays identical so a metric
   * reads the same wherever it appears.
   */
  compact?: boolean;
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
  compact = false,
}: MetricProps) {
  return (
    <div
      className={cn(
        "flex flex-col first:pl-0",
        compact ? "gap-1 px-3 py-3" : "gap-1.5 px-5 py-4",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground flex items-center gap-1.5",
          compact ? "text-[11px]" : "text-xs",
        )}
      >
        {icon}
        {label}
      </span>

      <span
        className={cn(
          "tnum leading-none font-medium tracking-tight",
          compact ? "text-2xl" : "text-3xl",
        )}
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
    </div>
  );
}

/**
 * The hairline row. Collapses to two columns on small screens and one on the
 * narrowest, with the dividers following the wrap so the rhythm survives.
 *
 * `wide` carries eight figures: four across at lg, all eight at xl. The
 * divider rules are written per breakpoint rather than by a single rule
 * because a border that follows the wrap has to know where the wrap is.
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
        "grid grid-cols-1 sm:grid-cols-2",
        "divide-y sm:divide-y-0 sm:divide-x",
        wide
          ? [
              "lg:grid-cols-4 xl:grid-cols-8",
              // Rows of two, then four, then one row of eight: each layout
              // draws a top border only on the items that actually wrapped.
              "sm:[&>*:nth-child(n+3)]:border-t",
              "lg:[&>*]:border-t-0 lg:[&>*:nth-child(n+5)]:border-t",
              "xl:[&>*]:border-t-0",
            ]
          : [
              "lg:grid-cols-4",
              "sm:[&>*:nth-child(n+3)]:border-t lg:[&>*]:border-t-0",
            ],
      )}
    >
      {children}
    </div>
  );
}
