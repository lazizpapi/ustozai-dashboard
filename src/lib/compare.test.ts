import { describe, expect, it } from "vitest";

import {
  counterVelocity,
  dailyRankSeries,
  dayTicks,
  priorWithinWindow,
  velocitySeries,
} from "./compare";

/**
 * Comparing apps to each other, and today to a while ago.
 *
 * Two honesty problems live here. Lifetime install totals are not comparable
 * across apps of different ages, so the market page compares velocity instead.
 * And a comparison labelled "week" that actually spans four days is exactly the
 * kind of quietly wrong number this dashboard exists to refuse, so every
 * windowed comparison reports the span it really measured.
 */

const at = (iso: string, value: number) => ({ capturedAt: iso, value });

describe("counterVelocity", () => {
  it("averages the counter's movement over the days it actually spans", () => {
    // 7000 to 7700 across 7 days is 100 a day, whatever shape the batches came in.
    const rate = counterVelocity([
      at("2026-08-08T02:00:00Z", 7000),
      at("2026-08-11T02:00:00Z", 7300),
      at("2026-08-15T02:00:00Z", 7700),
    ])!;

    expect(rate.perDay).toBe(100);
    expect(rate.spanDays).toBe(7);
  });

  it("is unmoved by the batch shape inside the window", () => {
    // Google lands installs in lumps. Two series with identical endpoints must
    // give the identical rate, or the figure measures Google's release
    // schedule rather than the app's growth.
    const smooth = counterVelocity([
      at("2026-08-08T02:00:00Z", 1000),
      at("2026-08-11T02:00:00Z", 1150),
      at("2026-08-15T02:00:00Z", 1350),
    ])!;
    const lumpy = counterVelocity([
      at("2026-08-08T02:00:00Z", 1000),
      at("2026-08-11T02:00:00Z", 1000),
      at("2026-08-15T02:00:00Z", 1350),
    ])!;

    expect(lumpy.perDay).toBe(smooth.perDay);
  });

  it("ignores readings older than the window", () => {
    const rate = counterVelocity(
      [
        at("2026-06-01T02:00:00Z", 0),
        at("2026-08-08T02:00:00Z", 7000),
        at("2026-08-15T02:00:00Z", 7700),
      ],
      7,
    )!;

    // The June row would drag the rate down to a trickle if it counted.
    expect(rate.perDay).toBe(100);
    expect(rate.spanDays).toBe(7);
  });

  it("returns null when the readings are less than a day apart", () => {
    // An hour of data extrapolated to a day is a fabrication.
    expect(
      counterVelocity([
        at("2026-08-15T02:00:00Z", 7000),
        at("2026-08-15T08:00:00Z", 7050),
      ]),
    ).toBeNull();
  });

  it("returns null for a single reading and for none", () => {
    expect(counterVelocity([at("2026-08-15T02:00:00Z", 7000)])).toBeNull();
    expect(counterVelocity([])).toBeNull();
  });

  it("reports a falling counter as negative rather than clamping", () => {
    // Play's published total does occasionally restate downward. Hiding that
    // behind a zero would make a correction look like a quiet week.
    const rate = counterVelocity([
      at("2026-08-08T02:00:00Z", 7700),
      at("2026-08-15T02:00:00Z", 7000),
    ])!;

    expect(rate.perDay).toBe(-100);
  });

  it("accepts rows in any order", () => {
    const rate = counterVelocity([
      at("2026-08-15T02:00:00Z", 7700),
      at("2026-08-08T02:00:00Z", 7000),
    ])!;

    expect(rate.perDay).toBe(100);
  });
});

describe("priorWithinWindow", () => {
  const rows = [
    at("2026-08-15T02:00:00Z", 50),
    at("2026-08-14T02:00:00Z", 45),
    at("2026-08-12T02:00:00Z", 40),
    at("2026-08-11T02:00:00Z", 30),
  ];

  it("uses a reading at or before the cutoff when one exists", () => {
    const prior = priorWithinWindow(rows, "2026-08-13T02:00:00Z")!;

    expect(prior.value).toBe(40);
    expect(prior.spanDays).toBe(3);
  });

  it("falls back to the oldest reading when nothing reaches the cutoff", () => {
    // The reported bug: the market page showed dashes everywhere because
    // competitor tracking started four days ago and nothing is a week old.
    // Four days of movement is real information; a dash claims we know nothing.
    const prior = priorWithinWindow(rows, "2026-08-08T02:00:00Z")!;

    expect(prior.value).toBe(30);
    expect(prior.spanDays).toBe(4);
  });

  it("returns null when every reading is under a day old", () => {
    // Comparing this morning against last night is noise, not a trend.
    expect(
      priorWithinWindow(
        [at("2026-08-15T08:00:00Z", 50), at("2026-08-15T02:00:00Z", 49)],
        "2026-08-08T00:00:00Z",
      ),
    ).toBeNull();
  });

  it("returns null for a single reading and for none", () => {
    expect(priorWithinWindow([at("2026-08-15T02:00:00Z", 50)], "2026-08-08T00:00:00Z")).toBeNull();
    expect(priorWithinWindow([], "2026-08-08T00:00:00Z")).toBeNull();
  });

  it("rounds the span to whole days so the label can say them", () => {
    const prior = priorWithinWindow(
      [at("2026-08-15T02:00:00Z", 50), at("2026-08-11T20:00:00Z", 30)],
      "2026-08-01T00:00:00Z",
    )!;

    expect(Number.isInteger(prior.spanDays)).toBe(true);
    expect(prior.spanDays).toBe(3);
  });
});

describe("dailyRankSeries", () => {
  const row = (capturedAt: string, slug: string, rank: number | null) => ({
    capturedAt,
    slug,
    rank,
  });

  it("keeps the last reading of each Tashkent day per app", () => {
    const series = dailyRankSeries([
      row("2026-08-14T03:00:00Z", "ustoz-ai", 26),
      row("2026-08-14T18:00:00Z", "ustoz-ai", 24),
      row("2026-08-15T03:00:00Z", "ustoz-ai", 22),
    ]);

    expect(series).toEqual([
      { date: "2026-08-14", "ustoz-ai": 24 },
      { date: "2026-08-15", "ustoz-ai": 22 },
    ]);
  });

  it("buckets by Tashkent days, not UTC ones", () => {
    // 20:00 UTC is already the next day in Tashkent (UTC+5). Bucketing by UTC
    // would file an evening reading under yesterday and shift the whole chart.
    const series = dailyRankSeries([row("2026-08-14T20:00:00Z", "ustoz-ai", 24)]);

    expect(series[0].date).toBe("2026-08-15");
  });

  it("puts every app on the same row for a shared time axis", () => {
    const series = dailyRankSeries([
      row("2026-08-15T03:00:00Z", "ustoz-ai", 24),
      row("2026-08-15T03:00:00Z", "praktika", 3),
    ]);

    expect(series).toEqual([{ date: "2026-08-15", "ustoz-ai": 24, praktika: 3 }]);
  });

  it("keeps a null rank as null rather than dropping the app", () => {
    // Null means the poll ran and the app was outside the chart. That is a
    // fact about the app, and the line should break rather than interpolate.
    const series = dailyRankSeries([
      row("2026-08-15T03:00:00Z", "ustoz-ai", 24),
      row("2026-08-15T03:00:00Z", "englify", null),
    ]);

    expect(series[0].englify).toBeNull();
  });

  it("sorts days oldest first so the chart reads left to right", () => {
    const series = dailyRankSeries([
      row("2026-08-15T03:00:00Z", "ustoz-ai", 22),
      row("2026-08-13T03:00:00Z", "ustoz-ai", 26),
      row("2026-08-14T03:00:00Z", "ustoz-ai", 24),
    ]);

    expect(series.map((point) => point.date)).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(dailyRankSeries([])).toEqual([]);
  });
});

describe("dayTicks", () => {
  it("marks each day once, at its first reading", () => {
    // The reported defect: hourly readings each carry a day label, so the
    // axis printed "13 Aug" three times and read as broken.
    const ticks = dayTicks([
      "2026-08-13T03:00:00Z",
      "2026-08-13T09:00:00Z",
      "2026-08-13T18:00:00Z",
      "2026-08-14T03:00:00Z",
      "2026-08-14T09:00:00Z",
    ]);

    expect(ticks).toEqual(["2026-08-13T03:00:00Z", "2026-08-14T03:00:00Z"]);
  });

  it("uses Tashkent days, matching the labels beside it", () => {
    // 20:00 UTC on the 14th is already the 15th in Tashkent, so it opens a
    // new day rather than joining the previous one.
    expect(
      dayTicks(["2026-08-14T10:00:00Z", "2026-08-14T20:00:00Z"]),
    ).toEqual(["2026-08-14T10:00:00Z", "2026-08-14T20:00:00Z"]);
  });

  it("thins the ticks when there are more days than room for labels", () => {
    // Ninety daily ticks would overprint into a smear. Every other day, or
    // every third, still reads as a time axis.
    const days = Array.from(
      { length: 40 },
      (_, index) => `2026-06-${String(index + 1).padStart(2, "0")}T06:00:00Z`,
    ).slice(0, 30);

    expect(dayTicks(days, 8).length).toBeLessThanOrEqual(8);
  });

  it("always keeps the most recent day", () => {
    // The right-hand end is where the eye lands for "where are we now", so
    // thinning must not drop it.
    const days = Array.from(
      { length: 20 },
      (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}T06:00:00Z`,
    );

    expect(dayTicks(days, 5).at(-1)).toBe(days.at(-1));
  });

  it("handles an empty series", () => {
    expect(dayTicks([])).toEqual([]);
  });
});

describe("velocitySeries", () => {
  const at = (date: string, value: number) => ({
    capturedAt: `${date}T06:00:00Z`,
    value,
  });

  it("reports a steady counter as a flat rate", () => {
    // 100 a day for a week should read as 100 a day, not as a shape.
    const series = velocitySeries(
      [
        at("2026-08-01", 1000),
        at("2026-08-02", 1100),
        at("2026-08-03", 1200),
        at("2026-08-04", 1300),
      ],
      2,
    );

    expect(series.every((point) => point.perDay === 100)).toBe(true);
  });

  it("smooths Google's batch counter instead of drawing its spikes", () => {
    // The counter sits still then jumps: 0, 0, 900. Differencing day to day
    // draws a flat line with one spike, which describes Google's publishing
    // schedule rather than the app's growth.
    const spiky = velocitySeries(
      [
        at("2026-08-01", 1000),
        at("2026-08-02", 1000),
        at("2026-08-03", 1000),
        at("2026-08-04", 1900),
      ],
      3,
    );

    const last = spiky.at(-1)!;
    expect(last.perDay).toBe(300);
  });

  it("attributes a rate to the day the window ends", () => {
    const series = velocitySeries(
      [at("2026-08-01", 0), at("2026-08-03", 200)],
      2,
    );

    expect(series.at(-1)!.date).toBe("2026-08-03");
  });

  it("keeps one point per day, using that day's last reading", () => {
    // 18:00 UTC is 23:00 in Tashkent, so both of the 2 Aug readings are the
    // same local day. An hour later would already be 3 Aug there, which is
    // the whole reason this reduction buckets on Tashkent rather than UTC.
    const series = velocitySeries(
      [
        { capturedAt: "2026-08-01T03:00:00Z", value: 1000 },
        { capturedAt: "2026-08-02T03:00:00Z", value: 1050 },
        { capturedAt: "2026-08-02T18:00:00Z", value: 1100 },
      ],
      1,
    );

    // 2 Aug ends at 1100, so the day's rate is 100 rather than 50.
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: "2026-08-02", perDay: 100 });
  });

  it("files a late-evening UTC reading under the next Tashkent day", () => {
    // Tashkent is UTC+5, so 20:00 UTC belongs to tomorrow locally. Bucketing
    // on UTC would merge it into the previous day and understate that day.
    const series = velocitySeries(
      [
        { capturedAt: "2026-08-01T06:00:00Z", value: 1000 },
        { capturedAt: "2026-08-01T20:00:00Z", value: 1100 },
      ],
      1,
    );

    expect(series).toEqual([{ date: "2026-08-02", perDay: 100 }]);
  });

  it("falls back to the oldest reading before the window is full", () => {
    // Three days of history with a seven day window still yields a rate,
    // because refusing to plot anything for the first week is worse than
    // plotting a shorter average.
    const series = velocitySeries(
      [at("2026-08-01", 0), at("2026-08-02", 100), at("2026-08-03", 200)],
      7,
    );

    expect(series).toHaveLength(2);
    expect(series.at(-1)!.perDay).toBe(100);
  });

  it("reports a restated counter as a negative rate rather than hiding it", () => {
    const series = velocitySeries([at("2026-08-01", 2000), at("2026-08-02", 1900)], 1);
    expect(series[0].perDay).toBe(-100);
  });

  it("returns nothing without at least two days", () => {
    expect(velocitySeries([at("2026-08-01", 1000)], 7)).toEqual([]);
    expect(velocitySeries([], 7)).toEqual([]);
    // Several readings on one day are still one day.
    expect(
      velocitySeries(
        [
          { capturedAt: "2026-08-01T03:00:00Z", value: 1000 },
          { capturedAt: "2026-08-01T09:00:00Z", value: 1010 },
        ],
        7,
      ),
    ).toEqual([]);
  });
});
