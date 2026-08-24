/**
 * Builds the daily Telegram message.
 *
 * Pure and dependency-free so the wording can be tested without a bot token.
 *
 * Two rules the formatter has to hold to:
 *
 * Never invent a comparison. A missing previous value means the history does
 * not go back that far, which is different from no change, and in the first
 * week of running they are easy to confuse.
 *
 * Never let a download figure read as live. Apple and Google both publish
 * yesterday at best, so every download line is dated explicitly.
 */

import { reviewSource } from "@/lib/format";

export interface DigestInput {
  date: string;
  rank: { current: number | null; previous: number | null; feedSize: number | null };
  iosRating: { current: number | null; previous: number | null; count: number | null };
  androidRating: { current: number | null; previous: number | null; count: number | null };
  iosDownloads: { date: string; units: number } | null;
  androidInstalls: { date: string; units: number } | null;
  newReviews: {
    rating: number;
    title: string | null;
    body: string | null;
    country: string;
    platform: string;
  }[];
  audience: { platform: string; current: number | null; previous: number | null; isExact: boolean }[];
  /** Days until the Instagram credential dies, when inside the warning window. */
  tokenExpiresInDays: number | null;
  failures: string[];
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const number = (value: number) => value.toLocaleString("en-US");

/** Rank improves as it falls, so the arrow is deliberately inverted. */
function rankMove(current: number | null, previous: number | null): string {
  if (current === null) return "";
  if (previous === null) return " (no week-ago reading yet)";
  const delta = previous - current;
  if (delta === 0) return " (flat on the week)";
  return delta > 0 ? ` (up ${delta} on the week)` : ` (down ${Math.abs(delta)} on the week)`;
}

function ratingMove(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "";
  const delta = current - previous;
  if (Math.abs(delta) < 0.005) return "";
  return delta > 0 ? ` (up ${delta.toFixed(2)})` : ` (down ${Math.abs(delta).toFixed(2)})`;
}

export function formatDigest(input: DigestInput): string {
  const lines: string[] = [`<b>Ustoz AI, ${escape(input.date)}</b>`, ""];

  /*
   * Problems first, above the numbers rather than under them.
   *
   * This block used to sit last, after the chart position and the downloads
   * and the follower counts. A reader who skims the top of a daily message and
   * stops when the news looks fine will never reach the bottom, which is how
   * the Instagram collector stayed dead for four days while a message naming
   * it arrived every morning.
   */
  if (input.failures.length > 0) {
    lines.push("<b>Collector problems</b>");
    for (const failure of input.failures.slice(0, 5)) {
      lines.push(`  ${escape(failure.slice(0, 140))}`);
    }
    lines.push("");
  }

  // Position
  if (input.rank.current !== null) {
    lines.push(
      `<b>#${input.rank.current}</b> in Education, Uzbekistan` +
        escape(rankMove(input.rank.current, input.rank.previous)),
    );
  } else if (input.rank.feedSize) {
    lines.push(`Outside the top ${input.rank.feedSize} in Education, Uzbekistan`);
  } else {
    lines.push("Chart position unavailable today");
  }
  lines.push("");

  // Downloads. Always dated, never presented as a live number.
  lines.push("<b>Downloads</b>");
  if (input.iosDownloads) {
    lines.push(
      `iOS ${number(input.iosDownloads.units)} on ${escape(input.iosDownloads.date)}`,
    );
  } else {
    lines.push("iOS not available (App Store Connect key not connected)");
  }
  if (input.androidInstalls) {
    lines.push(
      `Android ${number(input.androidInstalls.units)} on ${escape(input.androidInstalls.date)}`,
    );
  } else {
    lines.push("Android not available yet (needs two days of snapshots)");
  }
  lines.push("");

  // Ratings
  lines.push("<b>Rating</b>");
  const ios = input.iosRating;
  const android = input.androidRating;
  if (ios.current !== null) {
    lines.push(
      `iOS ${ios.current.toFixed(2)}` +
        (ios.count !== null ? ` from ${number(ios.count)} ratings` : "") +
        escape(ratingMove(ios.current, ios.previous)),
    );
  }
  if (android.current !== null) {
    lines.push(
      `Android ${android.current.toFixed(2)}` +
        (android.count !== null ? ` from ${number(android.count)} ratings` : "") +
        escape(ratingMove(android.current, android.previous)),
    );
  }
  lines.push("");

  // Reviews, with the ones worth acting on pulled out.
  const low = input.newReviews.filter((review) => review.rating <= 3);
  lines.push(`<b>Reviews</b>`);
  if (input.newReviews.length === 0) {
    lines.push("No new reviews");
  } else {
    lines.push(`${input.newReviews.length} new, ${low.length} at 3 stars or below`);
    for (const review of low.slice(0, 5)) {
      const text = review.title || review.body || "(no text)";
      lines.push(
        `  ${"★".repeat(review.rating)} ${escape(text.slice(0, 90))} ` +
          `[${escape(reviewSource(review.platform, review.country))}]`,
      );
    }
  }

  // Audience
  const withCounts = input.audience.filter((row) => row.current !== null);
  if (withCounts.length > 0) {
    lines.push("", "<b>Audience</b>");
    for (const row of withCounts) {
      const move =
        row.previous !== null && row.current !== row.previous
          ? ` (${row.current! > row.previous ? "+" : "-"}${number(Math.abs(row.current! - row.previous))} this week)`
          : "";
      const label = row.platform.charAt(0).toUpperCase() + row.platform.slice(1);
      lines.push(
        `${escape(label)} ${row.isExact ? "" : "about "}${number(row.current!)}${escape(move)}`,
      );
    }
  }

  /*
   * A dying credential is the one problem the team must act on personally.
   * Past 60 days the token cannot be refreshed at all and someone has to sign
   * in again, so this is stated plainly and above the ordinary failure list.
   */
  if (input.tokenExpiresInDays !== null) {
    const days = Math.max(0, Math.round(input.tokenExpiresInDays));
    lines.push(
      "",
      `<b>Action needed</b>`,
      days > 0
        ? `Instagram access expires in ${days} day${days === 1 ? "" : "s"}. Reauthorise it before then or the follower count stops updating.`
        : "Instagram access has expired. Reauthorise it to resume the follower count.",
    );
  }

  return lines.join("\n");
}
