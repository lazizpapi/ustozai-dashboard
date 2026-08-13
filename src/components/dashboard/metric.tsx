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

export function Metric({ icon, label, value, detail, change, asOf }: MetricProps) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 first:pl-0">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </span>

      <span className={cn("tnum text-3xl leading-none font-medium", "tracking-tight")}>
        {value}
      </span>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
        {detail ? <span>{detail}</span> : null}
        {change ? (
          <span className="text-foreground/70">
            <DeltaGlyph change={change} />
          </span>
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
 */
export function MetricStrip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        "divide-y sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t lg:[&>*]:border-t-0",
        "sm:divide-x lg:divide-x",
      )}
    >
      {children}
    </div>
  );
}
