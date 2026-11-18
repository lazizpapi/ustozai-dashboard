import Link from "next/link";

import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { channelLabel, foldRepeats, outcomeOf, pickChannel } from "@/lib/comments/channels";
import {
  fetchCommentActivity,
  type CommentActivityItem,
  type CommentChannel,
  type CommentChannelHealth,
} from "@/lib/comments/client";
import { formatNumber, timeAgo, NO_VALUE } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * What the comment bot has been saying on each channel, and whether each is
 * still awake.
 *
 * The bot replies to comments on Ustoz AI's YouTube and Telegram in the
 * admin's own voice, distilled from 12,972 replies a person actually wrote. It
 * answers what it safely can, hands the rest to a person, and on Telegram
 * catches spam. Every decision is recorded whether or not it posted, which is
 * what this page reads.
 *
 * One channel at a time, chosen by a URL parameter like the Growth page's
 * period, so a link can open Telegram directly and a refresh keeps the tab. The
 * channels used to share one list, and the only way to tell a YouTube comment
 * from a Telegram one was the shape of the author's name.
 *
 * The page exists because of a specific failure: for two days after launch the
 * only way to know what the bot had done was to open the database by hand. A
 * silent bot and a healthy-but-quiet bot look identical from the outside, so
 * the freshness figure is the point of the page as much as the feed is.
 *
 * Data comes over HTTP from the bot's own service rather than from our Supabase.
 * It keeps a separate database on purpose, so that a leak of its key cannot
 * reach this dashboard's user data.
 */

/** How the bot acted, as a word rather than a coloured dot. */
function Verdict({ item }: { item: CommentActivityItem }) {
  const { label, strong } = outcomeOf(item);
  return <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>;
}

/** Whether the channel is working, in the terms that fit how its comments arrive. */
function HealthMetric({ health }: { health: CommentChannelHealth }) {
  if (health.kind === "polled") {
    return (
      <Metric
        label="Last checked"
        value={health.lastPolledAt ? timeAgo(health.lastPolledAt) : NO_VALUE}
        // When this stops moving, nothing else on the screen is telling you
        // anything current.
        detail={health.alive ? "checking every minute" : "the scheduler has stopped"}
      />
    );
  }
  return (
    <Metric
      label="Last comment"
      value={health.lastCommentAt ? timeAgo(health.lastCommentAt) : NO_VALUE}
      detail="sent in as each is posted; a long gap may be a quiet day"
    />
  );
}

function spamDetail(caught: number, leftUp: number): string {
  if (caught === 0) return "nothing caught";
  if (leftUp === 0) return "all deleted";
  return `${formatNumber(leftUp)} still up, for a person to remove`;
}

function ChannelTabs({ channels, active }: { channels: CommentChannel[]; active: string }) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Channel">
      {channels.map(({ platform }) => (
        <Link
          key={platform}
          href={`/comments?channel=${platform}`}
          aria-current={platform === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            platform === active
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {channelLabel(platform)}
        </Link>
      ))}
    </nav>
  );
}

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const [result, { channel: requested }] = await Promise.all([
    load(fetchCommentActivity, "/comments"),
    searchParams,
  ]);

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { channels } = result.data;
  const channel = pickChannel(channels, requested);
  if (!channel) return <SetupNotice reason="no-data" />;

  const label = channelLabel(channel.platform);
  const { health, counts, recent } = channel;
  const posted = recent.filter((item) => item.posted);
  const spamCaught = counts.deleted24h + counts.wouldDelete24h;
  // Only Telegram is moderated today; any other channel shows it once it has caught something.
  const showSpam = channel.platform === "telegram" || spamCaught > 0;
  const decisions = foldRepeats(recent);

  return (
    <div className="space-y-10">
      <AutoRefresh />

      <PageHeader
        title="Comments"
        note="What the bot did on each channel, and the comments it handed over instead."
      />

      <ChannelTabs channels={channels} active={channel.platform} />

      <MetricStrip wide={showSpam}>
        <HealthMetric health={health} />
        <Metric label="Replied" value={formatNumber(counts.replied24h)} unit="24h" />
        <Metric
          label="Sent to a human"
          value={formatNumber(counts.flagged24h)}
          unit="24h"
          detail="for the team to answer"
        />
        <Metric
          label="Left alone"
          value={formatNumber(counts.skipped24h)}
          unit="24h"
          detail="out of scope, or nothing to say"
        />
        {showSpam ? (
          <Metric
            label="Spam caught"
            value={formatNumber(spamCaught)}
            unit="24h"
            detail={spamDetail(spamCaught, counts.wouldDelete24h)}
          />
        ) : null}
      </MetricStrip>

      {counts.stuck24h > 0 ? (
        <p className="text-sm">
          <span className="font-medium">{formatNumber(counts.stuck24h)} stuck part-way.</span>{" "}
          <span className="text-muted-foreground">
            The bot started on these and never finished; check its logs.
          </span>
        </p>
      ) : null}

      <Section title="Published replies" note={`Live on ${label}, in the brand's voice.`}>
        {posted.length === 0 ? (
          <Empty>Nothing posted on {label} in this window.</Empty>
        ) : (
          <ul className="divide-y">
            {posted.map((item) => (
              <li key={item.commentId} className="space-y-1 px-4 py-3">
                <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                  <span>{item.author ?? "Unknown"}</span>
                  <span className="tnum">{timeAgo(item.at)}</span>
                </div>
                <p className="text-muted-foreground text-sm">{item.comment}</p>
                <p className="text-sm font-medium">{item.reply}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Every decision"
        note="Including the comments it deliberately did not answer, and why. Repeats in a row show once."
        flush
      >
        {decisions.length === 0 ? (
          <Empty>No {label} comments handled yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="px-3 py-2 text-left font-normal">When</th>
                  <th className="px-3 py-2 text-left font-normal">Comment</th>
                  <th className="px-3 py-2 text-left font-normal">Outcome</th>
                  <th className="px-3 py-2 text-left font-normal">Why</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map(({ item, count }) => (
                  <tr key={item.commentId} className="border-b last:border-0 align-top">
                    <td className="text-muted-foreground tnum px-3 py-2 whitespace-nowrap">
                      {timeAgo(item.at)}
                    </td>
                    <td className="max-w-[22rem] px-3 py-2">
                      <span className="text-muted-foreground block text-xs">
                        {item.author ?? "Unknown"}
                        {count > 1 ? <span className="tnum"> · {formatNumber(count)} in a row</span> : null}
                      </span>
                      {item.comment}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Verdict item={item} />
                    </td>
                    <td className="text-muted-foreground max-w-[20rem] px-3 py-2">
                      {item.reason ?? NO_VALUE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
