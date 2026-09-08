import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { fetchCommentActivity } from "@/lib/comments/client";
import { formatNumber, timeAgo, NO_VALUE } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * What the YouTube comment bot has been saying, and whether it is still awake.
 *
 * The bot replies to comments on the Ustoz AI channel in the admin's own voice,
 * distilled from 12,972 replies a person actually wrote. It answers thanks and
 * content requests, escalates anything about someone's own payment or account,
 * and stays quiet on everything else. Every decision is recorded whether or not
 * it posted, which is what this page reads.
 *
 * The page exists because of a specific failure: for two days after launch the
 * only way to know what the bot had done was to open the database by hand. A
 * silent bot and a healthy-but-quiet bot look identical from the outside, so the
 * freshness figure below is the point of the page as much as the feed is.
 *
 * Data comes over HTTP from the bot's own service rather than from our Supabase.
 * It keeps a separate database on purpose, so that a leak of its key cannot
 * reach this dashboard's user data.
 */

/** How the bot acted, as a word rather than a coloured dot. */
function Verdict({ category }: { category: string }) {
  if (category === "reply") return <span className="font-medium">replied</span>;
  if (category === "flag") return <span className="font-medium">to a human</span>;
  if (category === "error") return <span className="font-medium">failed</span>;
  return <span className="text-muted-foreground">stayed quiet</span>;
}

export default async function CommentsPage() {
  const result = await load(fetchCommentActivity, "/comments");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { health, counts, recent } = result.data;
  const posted = recent.filter((item) => item.posted);

  return (
    <div className="space-y-10">
      <AutoRefresh />

      <PageHeader
        title="Comments"
        note="Replies the bot published on YouTube, and the ones it handed over instead."
      />

      <MetricStrip>
        <Metric
          label="Last checked"
          value={health.lastPolledAt ? timeAgo(health.lastPolledAt) : NO_VALUE}
          // The whole point of the page. When this stops moving, nothing else
          // on the screen is telling you anything current.
          detail={health.alive ? "checking every minute" : "the scheduler has stopped"}
        />
        <Metric label="Replied" value={formatNumber(counts.replied24h)} unit="24h" />
        <Metric
          label="Sent to a human"
          value={formatNumber(counts.flagged24h)}
          unit="24h"
          detail="payment and account problems"
        />
        <Metric
          label="Left alone"
          value={formatNumber(counts.skipped24h)}
          unit="24h"
          detail="out of scope, or nothing to say"
        />
      </MetricStrip>

      <Section
        title="Published replies"
        note="Live on the channel, in the brand's voice."
      >
        {posted.length === 0 ? (
          <Empty>Nothing posted yet in this window.</Empty>
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
        note="Including the comments it deliberately did not answer, and why."
        flush
      >
        {recent.length === 0 ? (
          <Empty>No comments handled yet.</Empty>
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
                {recent.map((item) => (
                  <tr key={item.commentId} className="border-b last:border-0 align-top">
                    <td className="text-muted-foreground tnum px-3 py-2 whitespace-nowrap">
                      {timeAgo(item.at)}
                    </td>
                    <td className="max-w-[22rem] px-3 py-2">
                      <span className="text-muted-foreground block text-xs">
                        {item.author ?? "Unknown"}
                      </span>
                      {item.comment}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Verdict category={item.category} />
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
