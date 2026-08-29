import { describe, expect, it } from "vitest";

import {
  CEO_ONLY_KEYS,
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_LABELS_UZ,
  SOCIAL_PLATFORM_KEYS,
  isMetricKey,
  visibleKeys,
} from "./metric-keys";

/**
 * The gate around the company's takings, and the labels a note is read by.
 *
 * The gate is tested the way roles.ts is tested: the failure is silent, and a
 * department seeing a revenue note is not something the running app would ever
 * complain about.
 */

describe("visibleKeys", () => {
  it("gives the CEO everything", () => {
    expect(visibleKeys("ceo")).toEqual([...METRIC_KEYS]);
  });

  it("keeps takings away from every department", () => {
    for (const role of ["marketing", "product", "it"] as const) {
      expect(visibleKeys(role)).not.toContain("revenue");
    }
  });

  it("fails closed when there is no role at all", () => {
    // An expired session should lose the finances, not gain them.
    expect(visibleKeys(null)).not.toContain("revenue");
  });

  it("withholds nothing but the takings", () => {
    const hidden = METRIC_KEYS.filter((key) => !visibleKeys("marketing").includes(key));
    expect(hidden).toEqual([...CEO_ONLY_KEYS]);
  });
});

describe("labels", () => {
  it("names every metric in both languages", () => {
    // A missing label would render as an empty cell rather than throwing, so
    // the completeness check has to live here.
    for (const key of METRIC_KEYS) {
      expect(METRIC_LABELS[key]).toBeTruthy();
      expect(METRIC_LABELS_UZ[key]).toBeTruthy();
    }
  });
});

describe("isMetricKey", () => {
  it("accepts a real key and refuses anything else", () => {
    expect(isMetricKey("ios_downloads")).toBe(true);
    expect(isMetricKey("downloads")).toBe(false);
    expect(isMetricKey(null)).toBe(false);
    expect(isMetricKey(7)).toBe(false);
  });
});

describe("SOCIAL_PLATFORM_KEYS", () => {
  it("points every platform at a real metric", () => {
    for (const key of Object.values(SOCIAL_PLATFORM_KEYS)) {
      expect(METRIC_KEYS).toContain(key);
    }
  });
});
