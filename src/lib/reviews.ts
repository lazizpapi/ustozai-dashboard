/**
 * What each release did to the rating.
 *
 * The reviews page shows the newest hundred and an average of them, and the
 * store pages show a lifetime mean that barely moves. Neither answers the
 * question a team actually asks the morning after shipping: was that build
 * better received than the one before it.
 *
 * The material has been there since the first day. Every review carries the
 * version the reviewer had installed, and nothing has ever read it.
 *
 * Two limits worth stating rather than hiding. The version is the one running
 * on the reviewer's phone, not necessarily the one they are describing, so a
 * complaint about an old bug can land against the build that fixed it. And
 * Google omits the version on some reviews; those are real reviews and
 * dropping them would understate the count, so they gather in one row that
 * says it cannot be attributed.
 */

/** The row this reduction reads, as the reviews table stores it. */
export interface VersionReview {
  platform: string;
  version: string | null;
  rating: number;
  submittedAt: string;
}

export interface VersionRow {
  platform: string;
  /** The store's version string, or "unknown" for reviews carrying none. */
  version: string;
  count: number;
  /** Mean of these reviews, to two places. Not the store-wide rating. */
  average: number;
  /** Reviews at three stars or below: the ones worth answering. */
  low: number;
  firstSeen: string;
  lastSeen: string;
  /**
   * This version's average minus the previous version's on the same store.
   *
   * Null for the oldest version held, and for the unattributed row, because
   * neither has a predecessor to be measured against. Null too when either
   * side holds fewer than MIN_DELTA_REVIEWS reviews. Never computed across
   * stores: App Store and Play ratings come from different populations, and
   * the gap between them says nothing about a release.
   */
  deltaVsPrevious: number | null;
}

/** The row that collects reviews the store did not attribute to a build. */
export const UNKNOWN_VERSION = "unknown";

/**
 * The fewest reviews a build needs before it is worth comparing.
 *
 * Ratings here cluster hard at five, so a mean is really a count of the people
 * who were unhappy, and at a handful of reviews a single one-star swings it by
 * a whole star. The first version of this table reported 2.2.3 as 1.03 stars
 * better than 2.2.2 off a six-review baseline, and 2.2.2 as 1.17 worse than a
 * version with exactly one review. Both numbers were arithmetically correct
 * and neither was true about the release.
 *
 * Ten is where one dissenter moves the mean by about a third of a star rather
 * than by a whole one. Below it the column measures who happened to review,
 * not what shipped, so it says nothing instead.
 */
export const MIN_DELTA_REVIEWS = 10;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Dotted version numbers, compared segment by segment as numbers.
 *
 * Returns 0 for anything it cannot read as numeric, which the caller treats as
 * "no opinion" and settles with the review date instead. Deliberately not a
 * semver parser: these are store version strings, not published packages, and
 * the only property needed is that 2.2.10 comes after 2.2.9.
 */
function compareVersions(a: string, b: string): number {
  const parse = (version: string) => version.split(".").map((part) => Number(part.trim()));
  const left = parse(a);
  const right = parse(b);

  if ([...left, ...right].some((part) => !Number.isFinite(part))) return 0;

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function versionBreakdown(reviews: VersionReview[]): VersionRow[] {
  const groups = new Map<string, VersionReview[]>();

  for (const review of reviews) {
    const version = (review.version ?? "").trim() || UNKNOWN_VERSION;
    const key = `${review.platform}\u0000${version}`;
    groups.set(key, [...(groups.get(key) ?? []), review]);
  }

  const rows = [...groups.entries()].map(([key, group]) => {
    const [platform, version] = key.split("\u0000");
    const dates = group.map((review) => review.submittedAt).sort();

    return {
      platform,
      version,
      count: group.length,
      average: round2(
        group.reduce((total, review) => total + review.rating, 0) / group.length,
      ),
      low: group.filter((review) => review.rating <= 3).length,
      firstSeen: dates[0],
      lastSeen: dates[dates.length - 1],
      deltaVsPrevious: null as number | null,
    };
  });

  /*
   * Ordered by the build, newest first, and by the version number rather than
   * by when somebody last reviewed it.
   *
   * The review date is the tempting key and it is wrong. A straggler on an old
   * build is ordinary: 2.1.4 collected an Android review after 2.2.7 had
   * shipped, which by date drops it between two current builds and then makes
   * the row above it compare itself against a release five builds older than
   * its actual predecessor. The column says "vs previous" and has to mean it.
   *
   * Segments are compared as numbers, which is the thing text ordering gets
   * wrong: as text 2.2.10 sorts below 2.2.9, and every comparison after a
   * tenth release would be against the wrong build. A version that is not
   * numeric at all falls back to the date, which is the best key left.
   *
   * The unattributed row spans the whole history and belongs to no build, so
   * it goes last on every store.
   */
  rows.sort((a, b) => {
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    if (a.version === UNKNOWN_VERSION) return 1;
    if (b.version === UNKNOWN_VERSION) return -1;
    return compareVersions(b.version, a.version) || b.firstSeen.localeCompare(a.firstSeen);
  });

  // Newest first means the predecessor is the next row down, on the same
  // store, and never the unattributed one.
  for (let i = 0; i < rows.length; i += 1) {
    const previous = rows[i + 1];
    if (
      rows[i].version === UNKNOWN_VERSION ||
      !previous ||
      previous.platform !== rows[i].platform ||
      previous.version === UNKNOWN_VERSION ||
      // Both sides, not just this one: a solid build measured against a
      // six-review predecessor produces a confident number about nothing.
      rows[i].count < MIN_DELTA_REVIEWS ||
      previous.count < MIN_DELTA_REVIEWS
    ) {
      continue;
    }
    rows[i].deltaVsPrevious = round2(rows[i].average - previous.average);
  }

  return rows;
}
