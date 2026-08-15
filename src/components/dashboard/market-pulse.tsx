import Link from "next/link";

import { IOS_APP_ID } from "@/lib/collectors/config";
import type { chartMovers } from "@/lib/market";

/**
 * Where we sit in the chart, in one line.
 *
 * The company view is about our own numbers, but "are we growing" is only
 * half a question without who we are growing against. This is the smallest
 * honest answer: our position, who leads, and who is immediately ahead of us,
 * which is the only competitor whose position is actionable this week.
 *
 * Renders nothing when we are outside the tracked depth. A pulse that cannot
 * find us has nothing to say, and inventing a placeholder row would take
 * space from figures that do.
 */

export function MarketPulse({ chart }: { chart: ReturnType<typeof chartMovers> }) {
  const movers = chart.movers;
  const ourIndex = movers.findIndex((mover) => mover.storeId === IOS_APP_ID);
  if (ourIndex === -1) return null;

  const ours = movers[ourIndex];
  const leader = movers[0];
  const ahead = ourIndex > 0 ? movers[ourIndex - 1] : null;

  return (
    <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b pb-3 text-xs">
      <span>
        <span className="text-foreground font-medium">#{ours.rank}</span> in
        Education
      </span>

      {ahead ? (
        <span>
          {ahead.name} at #{ahead.rank}, one place ahead
        </span>
      ) : (
        <span className="text-foreground">top of the chart</span>
      )}

      {leader.storeId !== IOS_APP_ID ? (
        <span>
          {leader.name} leads at #{leader.rank}
        </span>
      ) : null}

      <Link href="/market" className="hover:text-foreground ml-auto transition-colors">
        Compare all
      </Link>
    </div>
  );
}
