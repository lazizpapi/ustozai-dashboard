import Link from "next/link";

import { Metric, MetricStrip } from "@/components/dashboard/metric";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { load } from "@/app/load";
import { latestInstallRate } from "@/lib/installs";
import {
  androidDailyInstalls,
  iosDailyDownloads,
  ratingTrend,
  recentListingChanges,
  recentReviews,
} from "@/lib/db/queries";
import {
  formatDay,
  formatNumber,
  formatRating,
  formatRatingDelta,
  reviewSource,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * What do users feel?
 *
 * Ratings are the summary; the reviews are the evidence, so they get the
 * space. Low ratings are marked rather than sorted to the top: a complaint
 * matters more when you can see it arriving among the praise, and reordering
 * would hide whether last week was mostly good or mostly bad.
 *
 * Our own version history sits alongside, because "what did they feel" is
 * usually asked right after "what did we ship".
 */

const OUR_FIELDS = new Set(["version", "releaseNotes"]);

const FIELD_LABELS: Record<string, string> = {
  title: "name",
  description: "description",
  version: "version",
  releaseNotes: "release notes",
  screenshots: "screenshots",
  icon: "icon",
};

export async function ProductView() {
  const result = await load(() =>
    Promise.all([
      ratingTrend("ios"),
      ratingTrend("android"),
      recentReviews(14),
      iosDailyDownloads(30),
      androidDailyInstalls(30),
      recentListingChanges(20),
    ]),
  );

  if (result.kind === "unconfigured") {
    return <SetupNotice reason="unconfigured" detail={result.detail} />;
  }
  if (result.kind === "no-data") return <SetupNotice reason="no-data" />;

  const [ios, android, reviews, downloads, installs, listingChanges] = result.data;

  const installRate = latestInstallRate(installs);
  const lastDownload = downloads.at(-1) ?? null;

  // Our own releases, not competitors': this panel answers "what did we ship".
  const ourReleases = listingChanges.filter((change) =>
    change.changedFields.some((field) => OUR_FIELDS.has(field)),
  );

  const unhappy = reviews.filter((review) => review.rating <= 3).length;

  return (
    <div className="space-y-8">
      <MetricStrip>
        <Metric
          label="iOS rating"
          value={formatRating(ios.current)}
          detail={
            ios.ratingCount !== null ? `${formatNumber(ios.ratingCount)} ratings` : undefined
          }
          change={formatRatingDelta(ios.current, ios.previous, ios.spanDays)}
        />

        <Metric
          label="Android rating"
          value={formatRating(android.current)}
          detail={
            android.ratingCount !== null
              ? `${formatNumber(android.ratingCount)} ratings`
              : undefined
          }
          change={formatRatingDelta(android.current, android.previous, android.spanDays)}
        />

        <Metric
          label="App Store, daily"
          value={lastDownload ? formatNumber(lastDownload.downloads) : "—"}
          asOf={lastDownload ? `on ${formatDay(lastDownload.date)}` : undefined}
        />

        <Metric
          label="Play installs, daily"
          value={installRate ? formatNumber(installRate.perDay) : "—"}
          detail={
            installRate && installRate.spanDays > 1
              ? `over ${installRate.spanDays} days`
              : undefined
          }
          asOf={installRate ? `to ${formatDay(installRate.date)}` : undefined}
        />
      </MetricStrip>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="flex flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">Latest reviews</h2>
            <span className="text-muted-foreground text-xs">
              {reviews.length === 0
                ? "both stores"
                : `${unhappy} of the last ${reviews.length} at three stars or below`}
            </span>
          </div>

          {reviews.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reviews collected yet.</p>
          ) : (
            <ul className="divide-y">
              {reviews.map((review) => (
                <li key={review.id} className="flex gap-3 py-2">
                  <span
                    className={cn(
                      "tnum w-8 shrink-0 text-xs",
                      // A low rating is the one thing on this page worth
                      // finding without reading, so it gets weight rather
                      // than colour: colour already means iOS or Android.
                      review.rating <= 3
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {review.rating}/5
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs">
                      {review.title || review.body || "(no text)"}
                    </p>
                    <p className="text-muted-foreground/70 truncate text-[11px]">
                      {review.author ?? "anonymous"} ·{" "}
                      {reviewSource(review.platform, review.country)} ·{" "}
                      {formatDay(review.submittedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex shrink-0 items-baseline justify-between gap-4 border-b pb-2">
            <h2 className="text-sm font-medium">What we shipped</h2>
            <Link
              href="/reviews"
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              All reviews
            </Link>
          </div>

          {ourReleases.length === 0 ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              No release detected yet. A version or release-notes change on
              either store appears here.
            </p>
          ) : (
            <ul className="space-y-2">
              {ourReleases.slice(0, 8).map((release) => (
                <li
                  key={`${release.appId}-${release.detectedAt}`}
                  className="text-xs leading-relaxed"
                >
                  <span className="text-muted-foreground tnum">
                    {formatDay(release.detectedAt)}
                  </span>{" "}
                  <span>{release.appName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    {release.platform === "ios" ? "App Store" : "Google Play"},{" "}
                    {release.changedFields
                      .map((field) => FIELD_LABELS[field] ?? field)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
