import { Empty, PageHeader } from "@/components/dashboard/page-header";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { recentReviews } from "@/lib/db/queries";
import { formatDay, formatNumber, formatRating, reviewSource, NO_VALUE} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const result = await load(() => recentReviews(100), "/reviews");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const reviews = result.data;
  const low = reviews.filter((review) => review.rating <= 3);
  const average =
    reviews.length > 0
      ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
      : null;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Reviews"
        note="Most recent across both stores. Only reviews with text appear here."
      />

      <MetricStrip>
        <Metric label="Collected" value={formatNumber(reviews.length)} />
        <Metric
          label="Three stars or below"
          value={formatNumber(low.length)}
          detail="worth a reply"
        />
        <Metric
          label="Average of these"
          value={formatRating(average)}
          detail="not the store-wide rating"
        />
        <Metric
          label="Newest"
          value={reviews[0]?.submittedAt ? formatDay(reviews[0].submittedAt) : NO_VALUE}
        />
      </MetricStrip>

      {reviews.length === 0 ? (
        <Empty>No reviews collected yet. The daily run fetches these.</Empty>
      ) : (
        <ul className="divide-y">
          {reviews.map((review) => (
            <li key={review.id} className="flex gap-5 py-4">
              <span className="tnum text-muted-foreground w-10 shrink-0 pt-0.5 text-sm">
                {review.rating}/5
              </span>
              <div className="min-w-0 space-y-1.5">
                {review.title ? (
                  <p className="text-sm font-medium">{review.title}</p>
                ) : null}
                {review.body ? (
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {review.body}
                  </p>
                ) : null}
                <p className="text-muted-foreground/80 text-xs">
                  {review.author ?? "anonymous"} ·{" "}
                  {reviewSource(review.platform, review.country)} ·{" "}
                  {formatDay(review.submittedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        App Store reviews come from the public feed, which goes intermittently
        empty and runs dry after roughly 200 entries, so this is a rolling
        window rather than a complete archive. Google Play reviews are fetched
        in Uzbek and Russian; the code beside an Android review is the language
        it was written in, because Google publishes no reviewer country.
        Connecting an App Store Connect key would replace the Apple side with
        the full history and make replies possible.
      </p>
    </div>
  );
}
