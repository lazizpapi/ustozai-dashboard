import { ArrowDown, ArrowUp } from "lucide-react";

import { BrandLogo, type SocialKey } from "./brand-logo";
import { formatNumber, timeAgo } from "@/lib/format";
import type { SocialTrend } from "@/lib/db/queries";

/**
 * One audience platform on the wall display.
 *
 * Read from several meters away, so the count is the only thing at full size
 * and everything else is deliberately quiet. Direction is an arrow rather than
 * red and green: colour on this screen already means iOS or Android, and an
 * arrow works for anyone who cannot separate the two hues.
 */

const LABELS: Record<SocialKey, string> = {
  telegram: "Telegram",
  instagram: "Instagram",
  youtube: "YouTube",
};

export function AudienceRow({ trend }: { trend: SocialTrend }) {
  const platform = trend.platform as SocialKey;

  const change =
    trend.current !== null && trend.previous !== null ? trend.current - trend.previous : null;

  return (
    <div className="flex min-h-0 flex-col justify-center gap-[0.4vh] border-t py-[1.4vh] first:border-t-0">
      <div className="text-muted-foreground flex items-center gap-[0.6vw]">
        <BrandLogo platform={platform} className="size-[1.6vw] min-h-4 min-w-4" />
        <span className="text-[clamp(0.75rem,0.95vw,1.4rem)]">{LABELS[platform]}</span>
      </div>

      <div className="flex items-baseline gap-[0.8vw]">
        <span className="tnum text-[clamp(1.75rem,3.6vw,5rem)] leading-none font-medium tracking-tight">
          {trend.current === null ? (
            <span className="text-muted-foreground text-[clamp(1rem,1.4vw,2rem)]">
              no reading
            </span>
          ) : (
            <>
              {/* YouTube rounds every count to three significant figures, its
                  own API included. The approximation sign is the honest way to
                  print a number the platform itself will not state exactly. */}
              {trend.isExact ? "" : "≈"}
              {formatNumber(trend.current)}
            </>
          )}
        </span>

        {change !== null && change !== 0 ? (
          <span className="text-muted-foreground inline-flex items-center gap-[0.2vw] text-[clamp(0.7rem,0.9vw,1.3rem)]">
            {change > 0 ? (
              <ArrowUp className="size-[0.9vw] min-w-3" aria-hidden />
            ) : (
              <ArrowDown className="size-[0.9vw] min-w-3" aria-hidden />
            )}
            <span className="tnum">{formatNumber(Math.abs(change))}</span>
            <span>this week</span>
          </span>
        ) : null}
      </div>

      {trend.isStale ? (
        // checkedAt, not capturedAt: the latter is truncated to the hour the
        // reading is filed under, so it would overstate the age of a number
        // that was in fact read minutes ago.
        <span className="text-muted-foreground/70 text-[clamp(0.65rem,0.75vw,1rem)]">
          last read {timeAgo(trend.checkedAt)}
        </span>
      ) : null}
    </div>
  );
}
