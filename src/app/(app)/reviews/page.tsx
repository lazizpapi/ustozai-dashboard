import { Empty, PageHeader, Section } from "@/components/dashboard/page-header";
import { APP_STORE_MARK, GOOGLE_PLAY_MARK } from "@/components/tv/brand-logo";
import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { ownReleases, recentReviews, reviewsByVersion } from "@/lib/db/queries";
import { MIN_DELTA_REVIEWS, UNKNOWN_VERSION } from "@/lib/reviews";
import { formatDay, formatNumber, formatRating, reviewSource, NO_VALUE} from "@/lib/format";

export const dynamic = "force-dynamic";

/** The window the version breakdown looks back over, named in the copy. */
const VERSION_DAYS = 120;

/**
 * The change against the previous build, as a glyph and a number.
 *
 * Weight rather than colour, for the same reason the low ratings below are
 * marked rather than tinted: on this dashboard colour already means App Store
 * or Google Play, and a green number here would give it a second meaning.
 */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">{NO_VALUE}</span>;
  if (value === 0) return <span className="text-muted-foreground">no change</span>;

  return (
    <span className="tnum font-medium">
      {value > 0 ? "↑" : "↓"} {Math.abs(value).toFixed(2)}
    </span>
  );
}

export default async function ReviewsPage() {
  const result = await load(async () => {
    const [reviews, versions, releases] = await Promise.all([
      recentReviews(100),
      reviewsByVersion(VERSION_DAYS),
      ownReleases(VERSION_DAYS),
    ]);
    return { reviews, versions, releases };
  }, "/reviews");

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const { reviews, versions, releases } = result.data;
  const low = reviews.filter((review) => review.rating <= 3);
  const average =
    reviews.length > 0
      ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
      : null;

  // The day each build was first seen on its store, so a version row can say
  // when it shipped rather than only when people started reviewing it.
  const shippedOn = new Map(
    releases.map((release) => [`${release.platform}:${release.version}`, release.date]),
  );

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

      {/*
        How each build landed, which is the question the list below cannot
        answer. Absent until there is a breakdown to show, on the same terms as
        the conversion panel on the downloads page: a table of dashes teaches
        people to skip this part of the page.
      */}
      {versions.length > 0 ? (
        <Section
          title="By version"
          note={`the last ${VERSION_DAYS} days, by the build the reviewer had installed`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="px-3 py-2 text-left font-medium">Version</th>
                  <th className="px-3 py-2 text-left font-medium">Shipped</th>
                  <th className="px-3 py-2 text-right font-medium">Reviews</th>
                  <th className="px-3 py-2 text-right font-medium">Average</th>
                  <th className="px-3 py-2 text-right font-medium">vs previous</th>
                  <th className="px-3 py-2 text-right font-medium">Three or below</th>
                  <th className="px-3 py-2 text-right font-medium">Reviewed until</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((row) => (
                  <tr
                    key={`${row.platform}-${row.version}`}
                    className="border-b last:border-b-0"
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-muted-foreground [&>svg]:size-3.5">
                          {row.platform === "ios" ? APP_STORE_MARK : GOOGLE_PLAY_MARK}
                        </span>
                        {row.version === UNKNOWN_VERSION ? (
                          <span className="text-muted-foreground">not stated</span>
                        ) : (
                          <span className="tnum">{row.version}</span>
                        )}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {shippedOn.get(`${row.platform}:${row.version}`)
                        ? formatDay(shippedOn.get(`${row.platform}:${row.version}`)!)
                        : NO_VALUE}
                    </td>
                    <td className="tnum px-3 py-2 text-right">{formatNumber(row.count)}</td>
                    <td className="tnum px-3 py-2 text-right">{formatRating(row.average)}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta value={row.deltaVsPrevious} />
                    </td>
                    <td className="tnum px-3 py-2 text-right">{formatNumber(row.low)}</td>
                    <td className="text-muted-foreground px-3 py-2 text-right text-xs">
                      {formatDay(row.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-muted-foreground mt-4 max-w-2xl text-xs leading-relaxed">
            The version is the one the reviewer had installed, which is not
            always the one they are describing: a complaint about an old fault
            can land against the build that fixed it. Read a row as the mood
            during that build rather than as a verdict on it. Google publishes
            no version on some reviews, and those gather in the row marked not
            stated instead of being dropped.
          </p>
          <p className="text-muted-foreground mt-3 max-w-2xl text-xs leading-relaxed">
            A dash under vs previous is a refusal rather than a gap: the
            comparison needs at least {MIN_DELTA_REVIEWS} reviews on both
            builds, because these ratings cluster at five and a handful of them
            move the average by a whole star. A dash under shipped means the
            build predates listing tracking, which began in August 2026; every
            release since then carries its date.
          </p>
        </Section>
      ) : null}

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
