/**
 * Parser tests for Google Play.
 *
 * The fixture is the real ds:5 bootstrap block from the live product page,
 * captured 2026-08-11. The drift tests matter most here: the positional paths
 * into that block are an internal detail of Play's frontend, and the whole
 * point of the parser's strictness is that a layout change surfaces as a loud
 * failure instead of a plausible wrong number.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  extractDs5,
  parsePlayDetails,
  parseRatingHistogram,
} from "./play-details";
import { ParseError } from "./types";

const html = readFileSync(
  new URL("./__fixtures__/play-details-ds5.html", import.meta.url),
  "utf8",
);

describe("parsePlayDetails", () => {
  it("reads the exact install count Play publishes for free", () => {
    const snapshot = parsePlayDetails(html, "uz");

    expect(snapshot.installCount).toBe(530577);
    expect(snapshot.installLabel).toBe("500K+");
    expect(snapshot.platform).toBe("android");
  });

  it("reads the true rating, not the rounded one shown on the page", () => {
    const snapshot = parsePlayDetails(html, "uz");

    expect(snapshot.rating).toBeCloseTo(4.75731, 5);
    expect(snapshot.ratingCount).toBe(10288);
    expect(snapshot.version).toBe("2.2.6");
  });

  it("keeps the exact count and the rounded label as separate values", () => {
    const snapshot = parsePlayDetails(html, "uz");

    // The UI shows the label so it never implies more precision than Play does
    // publicly, while the series is built from the exact number.
    expect(String(snapshot.installCount)).not.toBe(snapshot.installLabel);
    expect(snapshot.installCount).toBeGreaterThan(500_000);
  });
});

describe("parseRatingHistogram", () => {
  it("returns all five buckets", () => {
    const histogram = parseRatingHistogram(html);

    expect(histogram[5]).toBe(9074);
    expect(histogram[1]).toBe(289);
  });

  it("sums to within a percent of the reported rating count", () => {
    // A cross-check on the positional paths: if [51][1] and [51][2] ever point
    // at unrelated nodes, these two stop agreeing.
    const total = Object.values(parseRatingHistogram(html)).reduce((a, b) => a + b, 0);
    const { ratingCount } = parsePlayDetails(html, "uz");

    expect(Math.abs(total - ratingCount!) / ratingCount!).toBeLessThan(0.01);
  });
});

describe("resilience to Play changing its payload", () => {
  it("throws when the ds:5 block is missing entirely", () => {
    expect(() => parsePlayDetails("<html><body>nothing here</body></html>", "uz")).toThrow(
      ParseError,
    );
  });

  it("throws when ds:5 is present but its data array is unparseable", () => {
    const broken = "AF_initDataCallback({key: 'ds:5', data:[not json], sideChannel: {}});</script>";
    expect(() => parsePlayDetails(broken, "uz")).toThrow(ParseError);
  });

  it("throws rather than returning null when the install position drifts", () => {
    // Simulates Play inserting a field: the install slot now holds a string.
    const drifted = html.replace("530577", '"530577"');
    expect(() => parsePlayDetails(drifted, "uz")).toThrow(/install count/);
  });

  it("throws when the rating position yields an impossible value", () => {
    const drifted = html.replace("4.75731", "47.5731");
    expect(() => parsePlayDetails(drifted, "uz")).toThrow(/rating outside/);
  });
});

describe("extractDs5", () => {
  it("returns a parsed array for a real page", () => {
    expect(Array.isArray(extractDs5(html))).toBe(true);
  });
});
