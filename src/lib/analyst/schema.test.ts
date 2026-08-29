import { describe, expect, it } from "vitest";

import {
  analystJsonSchema,
  analystReportSchema,
  storedAnalystReportSchema,
} from "./schema";

/**
 * The two halves of the report contract, which are deliberately not the same.
 *
 * Generation is strict: the API rejects a schema with an optional property, so
 * every field has to be required and "nothing to say" has to be expressible as
 * an empty array. Reading is not: the table holds reports written before
 * followUp existed, and refusing to render those would be losing history to a
 * schema change.
 */

/** A real report shape from before followUp existed. */
const beforeFollowUp = {
  health: "yellow",
  headline: "Downloads held steady while the Play rating slipped.",
  changes: [
    { metric: "App Store downloads", detail: "185 on 25 Aug, flat on the week", direction: "flat" },
  ],
  causes: [
    { claim: "The 2.4 release landed mid-week", evidence: "listing change on 24 Aug", confidence: "low" },
  ],
  recommendations: [
    {
      action: "Reply to the two one-star reviews from this week",
      why: "Play rating fell 4.76 to 4.75",
      expectedImpact: "Rating stops sliding",
      effort: "low",
    },
  ],
  competitorWatch: [{ app: "Praktika", note: "climbed to #3 from #7" }],
  dataGaps: ["Nothing explains the Tuesday dip in installs."],
};

describe("reading a stored report", () => {
  it("accepts one written before followUp existed", () => {
    const parsed = storedAnalystReportSchema.parse(beforeFollowUp);

    expect(parsed.followUp).toBeUndefined();
    expect(parsed.headline).toBe(beforeFollowUp.headline);
  });

  it("still accepts one that has followUp", () => {
    const parsed = storedAnalystReportSchema.parse({
      ...beforeFollowUp,
      followUp: [{ action: "Reply to the reviews", outcome: "Done; rating recovered to 4.76" }],
    });

    expect(parsed.followUp).toHaveLength(1);
  });
});

describe("generating a report", () => {
  it("refuses one with followUp missing", () => {
    /*
     * Pins the asymmetry. If this ever starts passing, followUp has become
     * optional in the generation schema, and the model will quietly stop
     * revisiting its own advice while every test still goes green.
     */
    expect(() => analystReportSchema.parse(beforeFollowUp)).toThrow();
  });

  it("demands followUp in the JSON schema handed to the API", () => {
    const schema = analystJsonSchema() as { required?: string[] };

    expect(schema.required).toContain("followUp");
  });

  it("carries no keyword the API's strict mode rejects", () => {
    // A rejected keyword fails the whole request rather than being ignored, so
    // this is the difference between a daily report and a daily stack trace.
    const json = JSON.stringify(analystJsonSchema());

    for (const keyword of ["$schema", "maxItems", "minItems", "maxLength", "minLength"]) {
      expect(json).not.toContain(`"${keyword}"`);
    }
  });
});
