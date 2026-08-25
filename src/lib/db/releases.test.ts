import { describe, expect, it } from "vitest";

import { snapToWindow } from "@/components/dashboard/rank-chart";
import { releaseMarkers } from "./queries";

/**
 * Deciding which listing readings were actually releases.
 *
 * The shapes are real. Every tracked app has a reading dated the day
 * collection started, which is the case this function exists to get right:
 * on 2026-08-15 the collector learned that Ustoz AI was on 2.2.7, and that is
 * not the same as 2.2.7 having shipped that afternoon.
 */

const row = (platform: string, version: string | null, detectedAt: string) => ({
  platform,
  version,
  detectedAt,
});

describe("releaseMarkers", () => {
  it("does not call the first reading a release", () => {
    // One reading is a baseline. Nothing was watched changing.
    expect(releaseMarkers([row("ios", "2.2.7", "2026-08-15T12:00:00Z")])).toEqual([]);
  });

  it("marks the day a version changed", () => {
    const markers = releaseMarkers([
      row("ios", "2.2.7", "2026-08-15T12:00:00Z"),
      row("ios", "2.2.8", "2026-08-17T09:00:00Z"),
    ]);

    expect(markers).toEqual([{ date: "2026-08-17", platform: "ios", version: "2.2.8" }]);
  });

  it("ignores a listing edit that left the version alone", () => {
    // New screenshots and a rewritten description are a marketing change, not
    // a build, and marking them would claim a release that never happened.
    const markers = releaseMarkers([
      row("ios", "2.2.8", "2026-08-15T12:00:00Z"),
      row("ios", "2.2.8", "2026-08-16T12:00:00Z"),
      row("ios", "2.2.8", "2026-08-17T12:00:00Z"),
    ]);

    expect(markers).toEqual([]);
  });

  it("keeps the two stores on their own timelines", () => {
    // They ship on different days, and Android's first reading is its own
    // baseline rather than a release triggered by iOS moving.
    const markers = releaseMarkers([
      row("ios", "2.2.7", "2026-08-15T12:00:00Z"),
      row("android", "2.2.7", "2026-08-15T12:00:00Z"),
      row("android", "2.2.8", "2026-08-16T12:00:00Z"),
      row("ios", "2.2.8", "2026-08-17T12:00:00Z"),
    ]);

    expect(markers).toEqual([
      { date: "2026-08-16", platform: "android", version: "2.2.8" },
      { date: "2026-08-17", platform: "ios", version: "2.2.8" },
    ]);
  });

  it("sorts readings that arrive out of order", () => {
    const markers = releaseMarkers([
      row("ios", "2.2.8", "2026-08-17T12:00:00Z"),
      row("ios", "2.2.7", "2026-08-15T12:00:00Z"),
    ]);

    expect(markers).toEqual([{ date: "2026-08-17", platform: "ios", version: "2.2.8" }]);
  });

  it("counts a rollback, which is a release worth seeing", () => {
    const markers = releaseMarkers([
      row("ios", "2.2.7", "2026-08-15T12:00:00Z"),
      row("ios", "2.2.8", "2026-08-17T12:00:00Z"),
      row("ios", "2.2.7", "2026-08-18T12:00:00Z"),
    ]);

    expect(markers.map((m) => m.version)).toEqual(["2.2.8", "2.2.7"]);
  });

  it("skips readings with no version rather than treating one as a change", () => {
    // Play sometimes reports no version at all. An absent version is not a
    // new version, and pairing it with the next real one would invent two.
    const markers = releaseMarkers([
      row("android", "2.2.7", "2026-08-15T12:00:00Z"),
      row("android", null, "2026-08-16T12:00:00Z"),
      row("android", "2.2.7", "2026-08-17T12:00:00Z"),
    ]);

    expect(markers).toEqual([]);
  });

  it("ignores a platform it does not chart", () => {
    expect(releaseMarkers([row("web", "9.9.9", "2026-08-15T12:00:00Z")])).toEqual([]);
  });

  it("returns markers oldest first, across both stores", () => {
    const markers = releaseMarkers([
      row("ios", "1.0", "2026-08-01T12:00:00Z"),
      row("ios", "1.1", "2026-08-20T12:00:00Z"),
      row("android", "1.0", "2026-08-01T12:00:00Z"),
      row("android", "1.1", "2026-08-10T12:00:00Z"),
    ]);

    expect(markers.map((m) => m.date)).toEqual(["2026-08-10", "2026-08-20"]);
  });
});

describe("snapToWindow", () => {
  /*
   * The axis these lines are drawn on is categorical: recharts places a
   * reference line by matching its value against the data, not by measuring a
   * date. A marker whose value is not one of the plotted timestamps lands
   * nowhere and vanishes silently, which is the failure this guards.
   */
  const marker = (date: string, version = "2.2.8", platform = "ios") => ({
    date,
    version,
    platform: platform as "ios" | "android",
  });

  const hourly = [
    "2026-08-15T09:00:00Z",
    "2026-08-15T18:00:00Z",
    "2026-08-16T09:00:00Z",
    "2026-08-17T09:00:00Z",
  ];

  it("snaps a release onto a timestamp that is actually plotted", () => {
    expect(snapToWindow([marker("2026-08-16")], hourly)).toEqual([
      { at: "2026-08-16T09:00:00Z", version: "2.2.8", platform: "ios" },
    ]);
  });

  it("takes the first reading of the day when there are several", () => {
    expect(snapToWindow([marker("2026-08-15")], hourly)[0].at).toBe("2026-08-15T09:00:00Z");
  });

  it("drops a release from before the window", () => {
    expect(snapToWindow([marker("2026-07-01")], hourly)).toEqual([]);
  });

  it("drops a release from after the window", () => {
    expect(snapToWindow([marker("2026-09-01")], hourly)).toEqual([]);
  });

  it("drops a day inside the window that has no reading behind it", () => {
    // A collector outage leaves a gap. Better no marker than one drawn nowhere.
    const gapped = ["2026-08-15T09:00:00Z", "2026-08-17T09:00:00Z"];

    expect(snapToWindow([marker("2026-08-16")], gapped)).toEqual([]);
  });

  it("copes with nothing to draw", () => {
    expect(snapToWindow(undefined, hourly)).toEqual([]);
    expect(snapToWindow([], hourly)).toEqual([]);
    expect(snapToWindow([marker("2026-08-16")], [])).toEqual([]);
  });

  it("works on plain dates as well as timestamps", () => {
    // The downloads chart plots one point per day rather than per reading.
    const daily = ["2026-08-15", "2026-08-16", "2026-08-17"];

    expect(snapToWindow([marker("2026-08-16")], daily)[0].at).toBe("2026-08-16");
  });
});
