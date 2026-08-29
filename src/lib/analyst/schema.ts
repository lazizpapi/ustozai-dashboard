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
 * Recursively drop keywords OpenAI's strict mode does not accept.
 *
 * `maxItems` comes from the `.max()` on recommendations. Strict mode supports
 * only a subset of JSON Schema and rejects the whole request if it meets one
 * of the others, so the cap is enforced on the way back by zod instead of on
 * the way out by the schema. The field description still states the limit,
 * which is what the model actually reads.
 */
const UNSUPPORTED = new Set([
  "$schema",
  "maxItems",
  "minItems",
  "maxLength",
  "minLength",
  "minimum",
  "maximum",
  "pattern",
  "format",
]);

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported);
  if (node === null || typeof node !== "object") return node;

  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED.has(key))
      .map(([key, value]) => [key, stripUnsupported(value)]),
  );
}

/**
 * JSON Schema for the API's structured-output format.
 *
 * Derived rather than hand-written, so the contract the model is held to and
 * the contract we validate against cannot drift apart.
 */
export function analystJsonSchema(): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(analystReportSchema)) as Record<string, unknown>;
}

/**
 * One note about one metric that moved.
 *
 * The interesting field is the last one. A model asked why a number moved will
 * always produce a reason, because producing text is what it does, and a
 * confident invented cause is worse than silence: it gets repeated in a meeting
 * and acted on. Giving "nothing here explains it" a field of its own makes that
 * a first-class answer rather than a failure to be talked out of.
 *
 * Evidence is required and separate from the note for the same reason the
 * analyst's pack is stored: a claim nobody can trace back to a number is a
 * claim nobody can check.
 */
export const metricNoteSchema = z.object({
  note_uz: z
    .string()
    .describe(
      "2-3 jumla, o'zbek tilida, lotin yozuvida. Nima o'zgargani va nima " +
        "sababdan bo'lishi mumkinligi. Ehtiyotkor ohangda: 'ehtimol', " +
        "'ko'rinishidan'. Faqat dashborddagi raqamlarga tayan.",
    ),
  evidence: z
    .array(
      z.object({
        source: z.string().describe("Which tool the fact came from."),
        fact: z.string().describe("The specific number or change, cited."),
      }),
    )
    .describe("What you actually read. Empty only when you found nothing."),
  no_clear_driver: z
    .boolean()
    .describe(
      "True when nothing in the data plausibly explains the movement. This is " +
        "an expected and useful answer, not a failure. Do not invent a cause " +
        "to avoid setting it.",
    ),
});

export type MetricNote = z.infer<typeof metricNoteSchema>;

export function metricNoteJsonSchema(): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(metricNoteSchema)) as Record<string, unknown>;
}
