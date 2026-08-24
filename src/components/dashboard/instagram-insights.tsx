import { InstagramReachChart } from "@/components/dashboard/instagram-reach-chart";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { Section } from "@/components/dashboard/page-header";
import { NO_VALUE, delta, formatDay, formatNumber, formatPercent } from "@/lib/format";
import type {
  InstagramAudience,
  InstagramAudienceBucket,
  InstagramPerformance,
  InstagramStoryRow,
  InstagramTopPost,
} from "@/lib/db/queries";

/**
 * Everything about Instagram that is not the follower count.
 *
 * Rendered only on the Instagram drill-down, below the follower sections that
 * every platform shares. Kept out of the page file because the page is generic
 * across three platforms and this is emphatically not.
 *
 * The through-line of the copy here is that several of these figures are
 * easier to misread than to read. Reach is a unique count and does not add up.
 * Demographic buckets do not cover everyone. A missing per-post metric means
 * the format has no such metric, not that the number was zero. Each of those
 * gets said where the figure is shown rather than in a footnote nobody reaches.
 */

/** Our own labels: the API returns titles in the account's locale. */
const GENDER_LABELS: Record<string, string> = {
  F: "Women",
  M: "Men",
  U: "Not stated",
};

function BucketBars({
  buckets,
  total,
  limit = 8,
  label,
}: {
  buckets: InstagramAudienceBucket[];
  total: number;
  limit?: number;
  label: (bucket: string) => string;
}) {
  const shown = buckets.slice(0, limit);
  const widest = shown[0]?.followers ?? 1;

  if (shown.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing reported yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {shown.map((bucket) => (
        <li key={bucket.bucket} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3">
          <span className="truncate text-sm" title={bucket.bucket}>
            {label(bucket.bucket)}
          </span>
          <span className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
            <span
              className="bg-foreground/70 block h-full rounded-full"
              style={{ width: `${Math.max(2, (bucket.followers / widest) * 100)}%` }}
            />
          </span>
          <span className="text-muted-foreground text-right text-xs tabular-nums">
            {formatPercent(bucket.followers, total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function InstagramInsights({
  performance,
  posts,
  audience,
  stories,
  followers,
}: {
  performance: InstagramPerformance;
  posts: InstagramTopPost[];
  audience: InstagramAudience | null;
  stories: InstagramStoryRow[];
  followers: number | null;
}) {
  const { daily, windowViews, windowInteractions, windowNewFollowers, bestReachDay } = performance;

  return (
    <div className="space-y-8">
      <MetricStrip wide>
        <Metric
          label={`Views, last ${performance.spanDays} days`}
          value={windowViews === null ? NO_VALUE : formatNumber(windowViews)}
          change={delta(windowViews, performance.previousViews, performance.spanDays)}
        />
        <Metric
          label="Interactions"
          value={windowInteractions === null ? NO_VALUE : formatNumber(windowInteractions)}
          detail="likes, comments, shares and saves"
          change={delta(
            windowInteractions,
            performance.previousInteractions,
            performance.spanDays,
          )}
        />
        <Metric
          label="New follows"
          value={windowNewFollowers === null ? NO_VALUE : formatNumber(windowNewFollowers)}
          // Instagram never reports unfollows, so this figure only ever counts
          // arrivals. The follower total above is the one that nets them off.
          detail="gross, so unfollows are not subtracted"
        />
        <Metric
          label="Best day for reach"
          value={bestReachDay?.reach === undefined ? NO_VALUE : formatNumber(bestReachDay?.reach)}
          detail={bestReachDay ? formatDay(bestReachDay.date) : "no reach collected yet"}
        />
      </MetricStrip>

      <Section title="Reach and views" note={`daily, last ${performance.spanDays} days`}>
        <InstagramReachChart days={daily} />
      </Section>

      <Section
        title="Top posts"
        note="ranked by accounts reached, published in the last 90 days"
        flush
      >
        {posts.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-sm">
            No posts collected yet. The next daily run reads the whole archive.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="px-5 py-2 font-medium">Posted</th>
                  <th className="px-3 py-2 font-medium">Post</th>
                  <th className="px-3 py-2 text-right font-medium">Reached</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-3 py-2 text-right font-medium">Saves</th>
                  <th className="px-5 py-2 text-right font-medium">Engagement</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.mediaId} className="border-b last:border-0">
                    <td className="text-muted-foreground px-5 py-2.5 whitespace-nowrap">
                      {formatDay(post.postedAt)}
                    </td>
                    <td className="max-w-[20rem] px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                          {post.mediaProductType === "REELS" ? "Reel" : "Post"}
                        </span>
                        {post.permalink ? (
                          <a
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:text-foreground text-muted-foreground truncate transition-colors"
                          >
                            {post.caption?.split("\n")[0] || "Untitled"}
                          </a>
                        ) : (
                          <span className="text-muted-foreground truncate">
                            {post.caption?.split("\n")[0] || "Untitled"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(post.reach)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(post.views)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(post.saved)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {post.engagementRate === null
                        ? NO_VALUE
                        : `${(post.engagementRate * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {audience ? (
        <Section
          title="Where the followers are"
          note={`as Instagram attributed them on ${formatDay(audience.date)}`}
        >
          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-xs tracking-wide uppercase">Country</h3>
              <BucketBars
                buckets={audience.countries}
                total={audience.attributed}
                label={(bucket) => bucket}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-xs tracking-wide uppercase">City</h3>
              <BucketBars
                buckets={audience.cities}
                total={audience.attributed}
                label={(bucket) => bucket.split(",")[0]}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-xs tracking-wide uppercase">Age</h3>
              <BucketBars
                buckets={[...audience.age].sort((a, b) => a.bucket.localeCompare(b.bucket))}
                total={audience.attributed}
                label={(bucket) => bucket}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-muted-foreground text-xs tracking-wide uppercase">Gender</h3>
              <BucketBars
                buckets={audience.gender}
                total={audience.attributed}
                label={(bucket) => GENDER_LABELS[bucket] ?? bucket}
              />
            </div>
          </div>
          <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
            Shares are of the {formatNumber(audience.attributed)} followers Instagram was willing
            to place
            {followers !== null && followers > audience.attributed
              ? `, which is ${formatNumber(followers - audience.attributed)} short of the ${formatNumber(followers)} the account has`
              : ""}
            . It withholds any bucket small enough to identify somebody, so these
            columns are not meant to add up to everybody.
          </p>
        </Section>
      ) : null}

      <Section title="Stories" note="the last fourteen days" flush>
        {stories.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-sm">
            No stories recorded yet. They are collected hourly while they are
            live.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="px-5 py-2 font-medium">Posted</th>
                  <th className="px-3 py-2 text-right font-medium">Reached</th>
                  <th className="px-3 py-2 text-right font-medium">Views</th>
                  <th className="px-3 py-2 text-right font-medium">Replies</th>
                  <th className="px-5 py-2 text-right font-medium">Of followers</th>
                </tr>
              </thead>
              <tbody>
                {stories.map((story) => (
                  <tr key={story.mediaId} className="border-b last:border-0">
                    <td className="text-muted-foreground px-5 py-2.5 whitespace-nowrap">
                      {story.permalink ? (
                        <a
                          href={story.permalink}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:text-foreground transition-colors"
                        >
                          {formatDay(story.postedAt)}
                        </a>
                      ) : (
                        formatDay(story.postedAt)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(story.reach)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(story.views)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(story.replies)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatPercent(story.reach, followers)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground px-5 pt-4 pb-1 text-xs leading-relaxed">
          Instagram forgets a story twenty-four hours after it is posted, so this
          record only holds what was collected while each one was still live and
          begins where collection did. A gap here is permanent.
        </p>
      </Section>
    </div>
  );
}
