import { describe, expect, it } from "vitest";

import {
  checkDownloadSlump,
  checkRankDrop,
  checkRatingDrop,
  formatMetricAlert,
} from "./metric-alerts";

/**
 * The rules that decide whether a number moving is worth a message.
 *
 * Every figure here is invented. What is real is the shape of each case: a
 * rank that slid, a rank that vanished, a launch spike that must not turn the
 * following fortnight into a stream of false slumps.
 */

describe("checkRankDrop", () => {
  it("fires when the app slides more than the threshold", () => {
    expect(checkRankDrop("Education, App Store", 12, 4)).toEqual({
      metric: "Education, App Store",
      detail: "#12, down 8 places from #4 yesterday",
    });
  });

  it("stays quiet for ordinary daily jitter", () => {
    // Five places is the threshold, so five places is not yet news.
    expect(checkRankDrop("Education, App Store", 9, 4)).toBeNull();
  });

  it("never fires on good news", () => {
    expect(checkRankDrop("Education, App Store", 3, 20)).toBeNull();
  });

  it("treats falling out of the chart as the loudest case", () => {
    const alert = checkRankDrop("Education, Google Play", null, 5, 100);

    expect(alert).toEqual({
      metric: "Education, Google Play",
      detail: "outside the top 100, was #5 yesterday",
    });
  });

  it("says chart rather than a made-up size when the feed size is unknown", () => {
    expect(checkRankDrop("Education", null, 5)?.detail).toBe(
      "outside the chart, was #5 yesterday",
    );
  });

  it("says nothing when there is nothing to compare against", () => {
    // Never charted, still not charted. Not news.
    expect(checkRankDrop("Education", null, null)).toBeNull();
    // Arriving on the chart is good news, and good news is not an alert.
    expect(checkRankDrop("Education", 30, null)).toBeNull();
  });
});

describe("checkDownloadSlump", () => {
  const steady = (count: number, downloads = 100) =>
    Array.from({ length: count }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      downloads,
    }));

  it("fires when a day falls well under the fortnight around it", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 20 }];

    expect(checkDownloadSlump("App Store downloads", days)).toEqual({
      metric: "App Store downloads",
      detail: "20 on 2026-08-11, against a typical 100 a day",
    });
  });

  it("leaves an ordinary dip alone", () => {
    const days = [...steady(10), { date: "2026-08-11", downloads: 70 }];

    expect(checkDownloadSlump("App Store downloads", days)).toBeNull();
  });

  it("is not fooled by a launch spike", () => {
    /*
     * The median is the whole point of this rule. One enormous day among
     * steady hundreds pulls a mean far above them, and every ordinary day
     * afterwards would read as a slump against it.
     */
    const days = [
      ...steady(9),
      { date: "2026-08-10", downloads: 50_000 },
      { date: "2026-08-11", downloads: 95 },
    ];

    expect(checkDownloadSlump("App Store downloads", days)).toBeNull();
  });

  it("waits for enough history before calling anything typical", () => {
    const days = [...steady(3), { date: "2026-08-04", downloads: 1 }];

    expect(checkDownloadSlump("App Store downloads", days)).toBeNull();
  });

  it("reports the day it crosses, then stays quiet", () => {
    /*
     * A slump that lasts is one piece of news. Reporting it every morning is
     * how the channel gets muted, so the rule fires on the crossing only.
     */
    const crossed = [...steady(10), { date: "2026-08-11", downloads: 20 }];
    expect(checkDownloadSlump("App Store downloads", crossed)).not.toBeNull();

    const stillDown = [...crossed, { date: "2026-08-12", downloads: 18 }];
    expect(checkDownloadSlump("App Store downloads", stillDown)).toBeNull();
  });

  it("reports again once it recovers and slumps a second time", () => {
    const days = [
      ...steady(10),
      { date: "2026-08-11", downloads: 20 },
      { date: "2026-08-12", downloads: 105 },
      { date: "2026-08-13", downloads: 19 },
    ];

    expect(checkDownloadSlump("App Store downloads", days)).not.toBeNull();
  });

  it("does not divide by a fortnight of zeroes", () => {
    const days = [...steady(10, 0), { date: "2026-08-11", downloads: 0 }];

    expect(checkDownloadSlump("App Store downloads", days)).toBeNull();
  });
});

describe("checkRatingDrop", () => {
  it("fires on a fall of a hundredth or more", () => {
    expect(checkRatingDrop("App Store rating", 4.62, 4.68)).toEqual({
      metric: "App Store rating",
      detail: "4.62, down from 4.68",
    });
  });

  it("ignores a fall too small to mean anything", () => {
    expect(checkRatingDrop("App Store rating", 4.67, 4.68)).toBeNull();
  });

  it("never fires on a rating going up", () => {
    expect(checkRatingDrop("App Store rating", 4.75, 4.68)).toBeNull();
  });

  it("says nothing without both readings", () => {
    expect(checkRatingDrop("App Store rating", null, 4.68)).toBeNull();
    expect(checkRatingDrop("App Store rating", 4.68, null)).toBeNull();
  });
});

describe("formatMetricAlert", () => {
  it("returns null on a quiet day rather than an empty message", () => {
    expect(formatMetricAlert([])).toBeNull();
  });

  it("lists what moved", () => {
    const message = formatMetricAlert([
      { metric: "Education, App Store", detail: "#12, down 8 places from #4 yesterday" },
    ]);

    expect(message).toBe(
      "<b>Worth a look</b>\n  Education, App Store: #12, down 8 places from #4 yesterday",
    );
  });

  it("escapes anything that would break the markup", () => {
    const message = formatMetricAlert([{ metric: "A & B", detail: "<b>x</b>" }]);

    expect(message).toContain("A &amp; B");
    expect(message).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("caps the list so the message stays readable on a phone", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      metric: `metric ${index}`,
      detail: "moved",
    }));

    expect(formatMetricAlert(many)).toContain("and 3 more");
  });
});
