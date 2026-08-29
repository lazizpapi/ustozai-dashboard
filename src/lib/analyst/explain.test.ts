import { describe, expect, it, vi } from "vitest";

import {
  MAX_NOTES_PER_RUN,
  explainMovements,
  explainPrompt,
  movementKey,
  unexplained,
} from "./explain";
import { metricNoteJsonSchema, metricNoteSchema } from "./schema";
import type { Movement } from "@/lib/collectors/metric-alerts";

/**
 * The parts of the explainer that can be checked without paying for a model.
 *
 * What is worth testing here is the restraint rather than the writing: that a
 * movement already explained is not explained again, that the cap holds, and
 * that a deployment without a key degrades to yesterday's behaviour instead of
 * taking the daily run down with it.
 */

const movement = (
  metricKey: Movement["metricKey"],
  date: string,
  extra: Partial<Movement> = {},
): Movement => ({
  metric: "App Store downloads",
  metricKey,
  direction: "up",
  date,
  magnitude: { current: 240, previous: 100 },
  detail: "240 on 2026-08-11, against a typical 100 a day",
  ...extra,
});

describe("unexplained", () => {
  it("skips a movement that already has a note", () => {
    const movements = [
      movement("ios_downloads", "2026-08-11"),
      movement("revenue", "2026-08-11"),
    ];

    const left = unexplained(movements, [
      { metricKey: "ios_downloads", movementDate: "2026-08-11" },
    ]);

    expect(left.map((m) => m.metricKey)).toEqual(["revenue"]);
  });

  it("matches on the day as well as the metric", () => {
    // The same metric moving again a week later is a different piece of news.
    const movements = [movement("ios_downloads", "2026-08-18")];

    const left = unexplained(movements, [
      { metricKey: "ios_downloads", movementDate: "2026-08-11" },
    ]);

    expect(left).toHaveLength(1);
  });

  it("caps the run and keeps the caller's order", () => {
    /*
     * The order is the priority. run-daily lists chart position first because
     * that is the figure somebody can act on, and the cap has to respect that
     * rather than explaining whichever three came back from the database first.
     */
    const movements = [
      movement("education_rank_ios", "2026-08-11"),
      movement("ios_downloads", "2026-08-11"),
      movement("revenue", "2026-08-11"),
      movement("active_users", "2026-08-11"),
      movement("telegram_members", "2026-08-11"),
    ];

    const left = unexplained(movements, []);

    expect(left).toHaveLength(MAX_NOTES_PER_RUN);
    expect(left.map((m) => m.metricKey)).toEqual([
      "education_rank_ios",
      "ios_downloads",
      "revenue",
    ]);
  });

  it("returns nothing when everything is already explained", () => {
    const movements = [movement("ios_downloads", "2026-08-11")];

    expect(
      unexplained(movements, [
        { metricKey: "ios_downloads", movementDate: "2026-08-11" },
      ]),
    ).toEqual([]);
  });
});

describe("movementKey", () => {
  it("joins the metric and the day with a plain space", () => {
    /*
     * Asserted on the literal string rather than by round-tripping. A key built
     * from a mangled separator still matches itself, so every behavioural test
     * of the dedup passes while the key is quietly wrong; only looking at the
     * characters catches it.
     */
    expect(movementKey({ metricKey: "ios_downloads", date: "2026-08-11" })).toBe(
      "ios_downloads 2026-08-11",
    );
  });

  it("keeps the same figure on two days apart", () => {
    expect(movementKey({ metricKey: "revenue", date: "2026-08-11" })).not.toBe(
      movementKey({ metricKey: "revenue", date: "2026-08-12" }),
    );
  });
});

describe("explainPrompt", () => {
  const prompt = explainPrompt(movement("ios_downloads", "2026-08-11"));

  it("states the movement so a tool step is not spent rediscovering it", () => {
    expect(prompt).toContain("App Store downloads");
    expect(prompt).toContain("2026-08-11");
    expect(prompt).toContain("240 on 2026-08-11, against a typical 100 a day");
  });

  it("carries both readings", () => {
    expect(prompt).toContain("now 240");
    expect(prompt).toContain("before 100");
  });

  it("says which way is good news, because rank runs the other way", () => {
    expect(prompt).toContain("good news");

    const fall = explainPrompt(
      movement("education_rank_ios", "2026-08-11", { direction: "down" }),
    );
    expect(fall).toContain("bad news");
  });

  it("names a missing reading rather than printing null at the model", () => {
    const arrived = explainPrompt(
      movement("education_rank_ios", "2026-08-11", {
        magnitude: { current: 42, previous: null },
      }),
    );

    expect(arrived).toContain("before none");
    expect(arrived).not.toContain("null");
  });
});

describe("explainMovements", () => {
  it("returns nothing at all when there is nothing to explain", async () => {
    expect(await explainMovements([])).toEqual(new Map());
  });

  it("degrades to no notes when the model is not configured", async () => {
    /*
     * The whole degradation contract in one test. Without a key the alert must
     * still go out exactly as it did before any of this existed, which means
     * returning an empty map rather than throwing, and without touching the
     * database on the way.
     */
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(await explainMovements([movement("ios_downloads", "2026-08-11")])).toEqual(
      new Map(),
    );

    vi.unstubAllEnvs();
  });
});

describe("metricNoteJsonSchema", () => {
  it("carries no keyword the API's strict mode rejects", () => {
    // A rejected keyword fails the whole request rather than being ignored, so
    // this is the difference between notes and a daily stack trace.
    const json = JSON.stringify(metricNoteJsonSchema());

    for (const keyword of ["$schema", "minLength", "maxLength", "minItems", "maxItems"]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
  });

  it("still describes every field the note needs", () => {
    const schema = metricNoteJsonSchema() as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties).sort()).toEqual([
      "evidence",
      "no_clear_driver",
      "note_uz",
    ]);
    // Required, so "no clear driver" cannot be expressed by leaving it out and
    // hoping the reader assumes the model just did not bother.
    expect(schema.required).toContain("no_clear_driver");
  });
});

describe("metricNoteSchema", () => {
  it("accepts a note that found nothing", () => {
    const parsed = metricNoteSchema.parse({
      note_uz: "Ma'lumotlarda aniq sabab ko'rinmaydi.",
      evidence: [],
      no_clear_driver: true,
    });

    expect(parsed.no_clear_driver).toBe(true);
  });

  it("refuses a note with no verdict on whether it found a driver", () => {
    expect(() =>
      metricNoteSchema.parse({ note_uz: "Yuklab olishlar oshdi.", evidence: [] }),
    ).toThrow();
  });
});
