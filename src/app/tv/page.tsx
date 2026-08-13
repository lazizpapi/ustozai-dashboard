import Image from "next/image";
import { AlertTriangle } from "lucide-react";

import { AudienceRow } from "@/components/tv/audience-row";
import { AutoRefresh } from "@/components/tv/auto-refresh";
import { LiveDot, audienceIsLive } from "@/components/tv/live-dot";
import { DownloadsChart } from "@/components/dashboard/downloads-chart";
import { refreshAudienceIfStale } from "@/lib/collectors/freshen";
import { requireSession } from "@/app/load";
import {
  androidDailyInstalls,
  collectorHealth,
  iosDailyDownloads,
  rankTrend,
  ratingTrend,
  socialTrends,
} from "@/lib/db/queries";
import { formatNumber, formatRating, rankDelta, timeAgo } from "@/lib/format";
import { currentTvTheme } from "@/lib/tv-theme";

export const dynamic = "force-dynamic";

/**
 * The wall display.
 *
 * Read from across a room by people who are not interacting with it, so the
 * rules are different from the browsable dashboard:
 *
 * It never scrolls. `h-dvh` plus `overflow-hidden` makes that structural
 * rather than a hope, and every size is a viewport-relative clamp() so 1080p
 * and 4K both fill exactly without a scrollbar or a letterbox.
 *
 * Its theme follows the Tashkent clock rather than the viewer's preference:
 * light through the working day when the room is bright, dark in the evening.
 * The class is set here rather than inherited so that someone toggling their
 * own laptop can never change what is on the wall. Decided on the server, so
 * the correct theme is in the first paint with no flash.
 *
 * The switch is a one second colour fade. An instant flip at the edge of
 * vision is genuinely distracting in a room people are working in, and a slow
 * fade is the difference between noticing it and not.
 *
 * There is one number per idea and nothing else competes with it. The rank is
 * the largest thing on screen because it is the question people walk in
 * asking.
 */
export default async function TvPage() {
  await requireSession();

  const theme = currentTvTheme();

  /*
   * The audience read is chained rather than listed alongside the others, so
   * socialTrends sees whatever it fetched. Sitting inside the same Promise.all
   * lets it overlap with the six database queries, which is most of its cost
   * hidden: the render waits for the slower of the two, not for the sum.
   */
  const [rank, ios, android, social, iosDownloads, androidInstalls, health] =
    await Promise.all([
      rankTrend(),
      ratingTrend("ios"),
      ratingTrend("android"),
      refreshAudienceIfStale().then(() => socialTrends()),
      iosDailyDownloads(30),
      androidDailyInstalls(30),
      collectorHealth(),
    ]);

  const move = rankDelta(rank.current, rank.previous);
  const failing = health.filter((source) => source.status === "failed");
  const newest = health.reduce<string | null>(
    (latest, source) => (latest === null || source.ranAt > latest ? source.ranAt : latest),
    null,
  );

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Tashkent",
  });

  return (
    <div
      className={`${theme} bg-background text-foreground flex h-dvh flex-col overflow-hidden px-[2.5vw] py-[2vh] transition-colors duration-1000`}
    >
      <AutoRefresh />

      <header className="flex shrink-0 items-baseline justify-between gap-[2vw] border-b pb-[1.4vh]">
        <h1 className="flex items-center gap-[0.6vw] text-[clamp(0.9rem,1.15vw,1.7rem)] font-medium tracking-tight">
          <Image
            src="/ustozai-icon.jpg"
            alt=""
            width={40}
            height={40}
            className="ring-foreground/10 size-[1.6vw] min-h-5 min-w-5 rounded-[0.35vw] ring-1"
            priority
          />
          Ustoz AI
        </h1>
        <div className="text-muted-foreground flex items-baseline gap-[1.6vw] text-[clamp(0.7rem,0.85vw,1.2rem)]">
          {failing.length > 0 ? (
            <span className="text-status-critical inline-flex items-center gap-[0.4vw]">
              <AlertTriangle className="size-[0.9vw] min-w-3" aria-hidden />
              {failing.length} source{failing.length === 1 ? "" : "s"} failing
            </span>
          ) : null}
          <span>updated {timeAgo(newest)}</span>
          <span>{today}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-[2.5vw] pt-[2vh]">
        {/* App: the rank is the headline, ratings support it, the chart shows
            where the installs have been going. */}
        <section className="col-span-8 flex min-h-0 flex-col">
          <div className="shrink-0">
            <p className="text-muted-foreground text-[clamp(0.75rem,0.95vw,1.4rem)]">
              Education, Uzbekistan
            </p>
            <div className="flex items-baseline gap-[1.4vw]">
              <span className="tnum text-[clamp(3rem,8vw,11rem)] leading-[0.9] font-medium tracking-tight">
                {rank.current === null
                  ? rank.feedSize
                    ? `>${rank.feedSize}`
                    : "—"
                  : `#${rank.current}`}
              </span>
              <span className="text-muted-foreground text-[clamp(0.8rem,1.1vw,1.6rem)]">
                {move.direction === "unknown" ? "first week of tracking" : move.label}
              </span>
            </div>
          </div>

          <div className="text-muted-foreground mt-[1.6vh] flex shrink-0 flex-wrap items-baseline gap-x-[2.5vw] gap-y-[0.6vh] border-t pt-[1.4vh] text-[clamp(0.75rem,0.95vw,1.4rem)]">
            <span>
              App Store{" "}
              <span className="tnum text-foreground">{formatRating(ios.current)}</span>
              {ios.ratingCount !== null ? ` from ${formatNumber(ios.ratingCount)}` : ""}
            </span>
            <span>
              Google Play{" "}
              <span className="tnum text-foreground">{formatRating(android.current)}</span>
              {android.ratingCount !== null ? ` from ${formatNumber(android.ratingCount)}` : ""}
            </span>
          </div>

          <div className="mt-[1.6vh] min-h-0 flex-1">
            <DownloadsChart ios={iosDownloads} android={androidInstalls} fill compact />
          </div>
        </section>

        {/* Audience: three rows, one number each. */}
        <section className="col-span-4 flex min-h-0 flex-col border-l pl-[2vw]">
          <div className="flex shrink-0 items-center justify-between gap-[1vw]">
            <p className="text-muted-foreground text-[clamp(0.75rem,0.95vw,1.4rem)]">
              Audience
            </p>
            {audienceIsLive(social) ? <LiveDot /> : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-around">
            {social.map((trend) => (
              <AudienceRow key={trend.platform} trend={trend} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
