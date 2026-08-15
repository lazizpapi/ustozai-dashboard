import { z } from "zod";

/**
 * The shape of an analyst report, defined once.
 *
 * The same schema does two jobs: it is exported to JSON Schema and handed to
 * the API as a structured-output format, which constrains generation so the
 * response is valid by construction; and it validates what comes back, so a
 * malformed report is caught here rather than three layers later when a page
 * tries to render it.
 *
 * Every field is required. An optional field in a model-facing schema is an
 * invitation to omit it, and a report missing its recommendations is not a
 * shorter report, it is a failed one.
 */

export const RECOMMENDATION_LIMIT = 5;

const Change = z.object({
  metric: z.string().describe("What moved, in plain words. e.g. 'App Store downloads'"),
  detail: z
    .string()
    .describe("The movement, citing the actual numbers from the briefing."),
  direction: z.enum(["up", "down", "flat"]),
});

const Cause = z.object({
  claim: z.string().describe("A candidate explanation for one of the changes."),
  evidence: z
    .string()
    .describe("The numbers in the briefing that support this. Cite them."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Low is expected and useful. Do not inflate it."),
});

const Recommendation = z.object({
  action: z.string().describe("One concrete thing to do next."),
  why: z.string().describe("The number in the briefing that motivates it."),
  expectedImpact: z.string().describe("What should move, and roughly how much."),
  effort: z.enum(["low", "medium", "high"]),
});

const CompetitorNote = z.object({
  app: z.string(),
  note: z.string().describe("What they did or where they moved, with numbers."),
});

export const analystReportSchema = z.object({
  health: z
    .enum(["green", "yellow", "red"])
    .describe(
      "green: growing or steady. yellow: something worth watching. " +
        "red: a real decline, or the data pipeline is broken.",
    ),
  headline: z
    .string()
    .describe("One sentence a founder could read and act on. No preamble."),
  changes: z.array(Change).describe("What actually moved in this window."),
  causes: z
    .array(Cause)
    .describe("Why, as far as the briefing can support. Empty is allowed."),
  recommendations: z
    .array(Recommendation)
    .max(RECOMMENDATION_LIMIT)
    .describe("Ordered by expected value. Fewer, better ones beat five weak ones."),
  competitorWatch: z.array(CompetitorNote),
  dataGaps: z
    .array(z.string())
    .describe(
      "Questions this briefing cannot answer. This is a required section: " +
        "naming what is missing is more useful than guessing at it.",
    ),
});

export type AnalystReport = z.infer<typeof analystReportSchema>;

/**
 * JSON Schema for the API's structured-output format.
 *
 * Derived rather than hand-written, so the contract the model is held to and
 * the contract we validate against cannot drift apart. Structured outputs
 * reject `$schema`, so it is stripped.
 */
export function analystJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(analystReportSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
