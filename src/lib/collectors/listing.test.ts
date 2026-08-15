/**
 * Listing-change tracking: what a store page says about an app, hashed.
 *
 * The one property everything below defends is that the hash covers stable
 * metadata only. Ratings and install counts drift every hour; if they leaked
 * into the hash, the timeline would report a "listing change" on every poll
 * and teach people to ignore the section that exists to catch real ASO moves.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hashListing, parseIosListing, parsePlayListing } from "./listing";
import { ANDROID_PACKAGE, IOS_APP_ID } from "./config";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const lookupFixture = () => JSON.parse(fixture("itunes-lookup-uz.json"));

describe("parseIosListing", () => {
  it("captures the metadata Apple lets us see", () => {
    const listing = parseIosListing(lookupFixture(), IOS_APP_ID);

    expect(listing).not.toBeNull();
    expect(listing!.platform).toBe("ios");
    expect(listing!.storeId).toBe(IOS_APP_ID);
    expect(listing!.fields.title).toBe("Ustoz AI");
    expect(listing!.fields.version).toBe("2.2.6");
    expect(listing!.fields.description).toContain("Ustoz");
    expect(listing!.fields.screenshots).toHaveLength(7);
    expect(listing!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores rating drift entirely", () => {
    // The trap this file exists for. Two reads an hour apart differ only in
    // rating counts; they must hash identically or every poll is a "change".
    const a = lookupFixture();
    const b = lookupFixture();
    b.results[0].userRatingCount = 999999;
    b.results[0].averageUserRating = 1.1;

    expect(parseIosListing(a)!.contentHash).toBe(parseIosListing(b)!.contentHash);
  });

  it("changes hash when the description actually changes", () => {
    const a = lookupFixture();
    const b = lookupFixture();
    b.results[0].description = "A rewritten pitch.";

    expect(parseIosListing(a)!.contentHash).not.toBe(parseIosListing(b)!.contentHash);
  });

  it("returns null for a storefront that does not carry the app", () => {
    expect(parseIosListing({ resultCount: 0, results: [] })).toBeNull();
  });

  it("attributes the listing to the app that was requested", () => {
    // Same regression class as parseLookup: a competitor payload without
    // trackId must never be filed under our id.
    const noId = { resultCount: 1, results: [{ trackName: "X", description: "d" }] };
    expect(parseIosListing(noId, "6504232456")!.storeId).toBe("6504232456");
  });
});

describe("parsePlayListing", () => {
  it("captures title, description and version from the page we already fetch", () => {
    const listing = parsePlayListing(fixture("play-details-ds5.html"), ANDROID_PACKAGE);

    expect(listing.platform).toBe("android");
    expect(listing.storeId).toBe(ANDROID_PACKAGE);
    expect(listing.fields.title).toContain("Ustoz");
    expect(listing.fields.description).toContain("kurslar");
    expect(typeof listing.fields.version === "string" || listing.fields.version === null).toBe(
      true,
    );
  });
});

describe("hashListing", () => {
  it("does not depend on key insertion order", () => {
    expect(hashListing({ a: "1", b: "2" })).toBe(hashListing({ b: "2", a: "1" }));
  });

  it("distinguishes value moves between keys", () => {
    // A naive concatenation would hash {a:"xy"} and {ax:"y"} the same.
    expect(hashListing({ a: "xy" })).not.toBe(hashListing({ ax: "y" }));
  });

  it("treats null and absent as the same, so a parser gap is not a change", () => {
    // If Play's description position shifts, the field becomes null. That
    // should register as one change (content went missing), and then reads
    // with the field null or omitted must agree so it never flaps.
    expect(hashListing({ a: "1", b: null })).toBe(hashListing({ a: "1" }));
  });
});
