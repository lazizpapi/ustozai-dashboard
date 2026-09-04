import { describe, expect, it } from "vitest";

import { MIN_DELTA_REVIEWS, versionBreakdown, type VersionReview } from "./reviews";

/**
 * What each release did to the rating.
 *
 * The reviews page shows the newest hundred and a store-wide average, neither
 * of which answers the question a team asks after shipping: was that build
 * better received than the last one. The version a reviewer had installed has
 * been collected since the first day and never read.
 */

function review(
  version: string | null,
  rating: number,
  submittedAt: string,
  platform = "ios",
): VersionReview {
  return { platform, version, rating, submittedAt };
}

/** A build with enough reviews behind it to be worth comparing. */
function many(
  version: string,
  rating: number,
  submittedAt: string,
  count: number,
  platform = "ios",
): VersionReview[] {
  return Array.from({ length: count }, () =>
    review(version, rating, submittedAt, platform),
  );
}

describe("versionBreakdown", () => {
  it("averages each version separately", () => {
    const rows = versionBreakdown([
      review("2.2.7", 5, "2026-08-10T00:00:00Z"),
      review("2.2.7", 4, "2026-08-11T00:00:00Z"),
      review("2.2.8", 3, "2026-08-18T00:00:00Z"),
    ]);

    expect(rows.map((row) => [row.version, row.count, row.average])).toEqual([
      ["2.2.8", 1, 3],
      ["2.2.7", 2, 4.5],
    ]);
  });

  it("rounds the average to two places", () => {
    // Three fours and a five is 4.25; two fours and a five is 4.33 recurring,
    // and a rating printed to fifteen decimals reads as a bug.
    const rows = versionBreakdown([
      review("1.0", 4, "2026-08-10T00:00:00Z"),
      review("1.0", 4, "2026-08-10T00:00:00Z"),
      review("1.0", 5, "2026-08-10T00:00:00Z"),
    ]);
    expect(rows[0].average).toBe(4.33);
  });

  it("compares a version against the one before it on the same store", () => {
    const rows = versionBreakdown([
      ...many("2.2.7", 4, "2026-08-10T00:00:00Z", MIN_DELTA_REVIEWS),
      ...many("2.2.8", 5, "2026-08-18T00:00:00Z", MIN_DELTA_REVIEWS),
    ]);

    expect(rows[0].version).toBe("2.2.8");
    expect(rows[0].deltaVsPrevious).toBe(1);
    // The oldest version has nothing to be compared against.
    expect(rows[1].deltaVsPrevious).toBeNull();
  });

  it("withholds the comparison when the previous build has too few reviews", () => {
    // The live table showed 2.2.3 at 1.03 stars above 2.2.2, off a six-review
    // baseline. The arithmetic is right and the claim is not: at that sample
    // one reviewer moves the mean by more than a release plausibly does.
    const rows = versionBreakdown([
      ...many("2.2.2", 3, "2026-08-01T00:00:00Z", MIN_DELTA_REVIEWS - 1),
      ...many("2.2.3", 5, "2026-08-10T00:00:00Z", MIN_DELTA_REVIEWS),
    ]);

    expect(rows[0].version).toBe("2.2.3");
    expect(rows[0].deltaVsPrevious).toBeNull();
    // Everything the sample does support is still reported.
    expect(rows[0].average).toBe(5);
    expect(rows[1].count).toBe(MIN_DELTA_REVIEWS - 1);
  });

  it("withholds the comparison when this build has too few reviews", () => {
    const rows = versionBreakdown([
      ...many("2.2.2", 5, "2026-08-01T00:00:00Z", MIN_DELTA_REVIEWS),
      ...many("2.2.3", 3, "2026-08-10T00:00:00Z", MIN_DELTA_REVIEWS - 1),
    ]);

    expect(rows[0].version).toBe("2.2.3");
    expect(rows[0].deltaVsPrevious).toBeNull();
  });

  it("compares once both builds clear the floor", () => {
    const rows = versionBreakdown([
      ...many("2.2.2", 4, "2026-08-01T00:00:00Z", MIN_DELTA_REVIEWS),
      ...many("2.2.3", 5, "2026-08-10T00:00:00Z", MIN_DELTA_REVIEWS),
    ]);

    expect(rows[0].deltaVsPrevious).toBe(1);
  });

  it("does not compare across stores", () => {
    // App Store and Play ratings come from different populations, and a
    // difference between them says nothing about the release.
    const rows = versionBreakdown([
      review("2.2.8", 5, "2026-08-18T00:00:00Z", "ios"),
      review("2.2.8", 3, "2026-08-18T00:00:00Z", "android"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deltaVsPrevious === null)).toBe(true);
  });

  it("counts the reviews worth answering", () => {
    const rows = versionBreakdown([
      review("2.2.8", 5, "2026-08-18T00:00:00Z"),
      review("2.2.8", 3, "2026-08-19T00:00:00Z"),
      review("2.2.8", 1, "2026-08-20T00:00:00Z"),
    ]);
    expect(rows[0].low).toBe(2);
  });

  it("keeps the span of days each version was reviewed over", () => {
    const rows = versionBreakdown([
      review("2.2.8", 5, "2026-08-20T00:00:00Z"),
      review("2.2.8", 4, "2026-08-18T00:00:00Z"),
    ]);
    expect(rows[0].firstSeen).toBe("2026-08-18T00:00:00Z");
    expect(rows[0].lastSeen).toBe("2026-08-20T00:00:00Z");
  });

  it("gathers reviews with no version under one row, listed last", () => {
    // Play omits the version on some reviews. Those are real reviews and
    // dropping them would understate the count; they just cannot be filed.
    const rows = versionBreakdown([
      review(null, 5, "2026-08-25T00:00:00Z"),
      review("", 4, "2026-08-26T00:00:00Z"),
      review("2.2.7", 3, "2026-08-10T00:00:00Z"),
    ]);

    expect(rows.map((row) => row.version)).toEqual(["2.2.7", "unknown"]);
    expect(rows[1].count).toBe(2);
    // Nothing is "before" a row that is not a version, so no comparison.
    expect(rows[1].deltaVsPrevious).toBeNull();
  });

  it("orders newest release first within a store", () => {
    const rows = versionBreakdown([
      review("2.2.6", 5, "2026-08-01T00:00:00Z"),
      review("2.2.8", 5, "2026-08-18T00:00:00Z"),
      review("2.2.7", 5, "2026-08-09T00:00:00Z"),
    ]);
    expect(rows.map((row) => row.version)).toEqual(["2.2.8", "2.2.7", "2.2.6"]);
  });

  it("orders by the build, not by when somebody last reviewed it", () => {
    // A straggler on an old build is real and common: 2.1.4 collected one
    // Android review after 2.2.7 had shipped. Ordered by review date it lands
    // between two current builds, and then "vs previous" compares 2.2.7
    // against a release five builds older than the one before it.
    const rows = versionBreakdown([
      ...many("2.2.6", 4, "2026-08-10T00:00:00Z", MIN_DELTA_REVIEWS),
      review("2.1.4", 5, "2026-08-11T00:00:00Z"),
      ...many("2.2.7", 5, "2026-08-12T00:00:00Z", MIN_DELTA_REVIEWS),
    ]);

    expect(rows.map((row) => row.version)).toEqual(["2.2.7", "2.2.6", "2.1.4"]);
    // The delta is the proof: 1.00 is 2.2.7 against 2.2.6. Ordered by review
    // date the straggler would sit between them and this would be 0.
    expect(rows[0].deltaVsPrevious).toBe(1);
  });

  it("compares version segments as numbers", () => {
    // The reason this was ordered by date first. Compared as text, 2.2.10
    // sorts below 2.2.9 and every delta after a tenth release is wrong.
    const rows = versionBreakdown([
      review("2.2.9", 4, "2026-08-10T00:00:00Z"),
      review("2.2.10", 5, "2026-08-20T00:00:00Z"),
    ]);
    expect(rows.map((row) => row.version)).toEqual(["2.2.10", "2.2.9"]);
  });

  it("falls back to the review date for a version it cannot parse", () => {
    const rows = versionBreakdown([
      review("spring-build", 4, "2026-08-10T00:00:00Z"),
      review("winter-build", 5, "2026-08-20T00:00:00Z"),
    ]);
    expect(rows.map((row) => row.version)).toEqual(["winter-build", "spring-build"]);
  });

  it("has nothing to say about nothing", () => {
    expect(versionBreakdown([])).toEqual([]);
  });
});
