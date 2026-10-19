import "server-only";

import { ASK_TOOLS, clampArgs } from "./tools";
import { runTool } from "./run-tool";
import { formatFactsBlock } from "./memory";
import { metricNoteJsonSchema, metricNoteSchema, type MetricNote } from "./schema";
import { analystModel, anthropicKey } from "@/lib/env";
import { claudeClient, runToolLoop, type Send } from "./claude";
import { saveMetricNote } from "@/lib/db/persist";
import { activeFacts, notedMovements } from "@/lib/db/queries";
import type { Movement } from "@/lib/collectors/metric-alerts";

/**
 * Writing down why a number moved, on the day it moved.
 *
 * The rules in metric-alerts.ts can tell you that App Store downloads doubled.
 * Nobody has ever been told why, and the answer was reconstructed by hand every
 * time: open the releases, check the reviews, remember what marketing did that
 * week. A fortnight later the reconstruction is guesswork, because three more
 * things have happened on top of it.
 *
 * So this runs while the surrounding data still says what it said, and stores
 * what it found. The model gets the same tools the chat has, which is the whole
 * trick: it can go and look rather than being handed a fixed briefing that may
 * not contain the one number that would have explained anything.
 *
 * Two things it is built to get right, both about restraint:
 *
 * It is allowed to find nothing. A model asked why a number moved will always
 * produce a reason, because producing text is what it does. Most real movements
 * have causes this dashboard cannot see, a blogger or an exam week, and a
 * confident invented cause is worse than silence because somebody acts on it.
 * "No clear driver" is a first-class outcome here, not a failed run.
 *
 * It is capped. Three notes a day, five tool steps each, and a wall-clock
 * deadline, because this runs inside a cron request that also has collectors to
 * finish. Past any of those limits the movement still gets its alert; it just
 * goes out without a note, which is exactly what yesterday's behaviour was.
 */

/** Three is the number of things anybody reads before scrolling past. */
export const MAX_NOTES_PER_RUN = 3;

/** Enough looking around for one movement. The chat gets eight for a reason. */
export const MAX_EXPLAIN_STEPS = 5;

/**
 * The share of the daily cron's budget this may spend.
 *
 * The route allows 300 seconds and the collectors have already run by the time
 * this starts. Two minutes leaves room for the run to finish and record itself,
 * which matters more than the third note.
 */
export const EXPLAIN_BUDGET_MS = 120_000;

const SYSTEM_PROMPT = `You are explaining one movement in one metric on the internal dashboard of Ustoz AI, an education app in Uzbekistan published on the App Store and Google Play. You are writing for the founding team.

You will be told what moved, by how much, and on which day. Your job is to find out whether anything in this dashboard's own data explains it, and then write a short note.

Use the tools to look for things that happened in the same window as the movement:
- a release or a listing change (get_listing_changes)
- competitors moving on the same chart (get_chart, get_market)
- a wave of reviews, good or bad (get_reviews)
- the discovery funnel changing shape, which is what a featuring looks like (get_conversion_funnel)
- keyword positions moving (get_keywords)
- audience and posts (get_audience, get_instagram)
- a stalled or broken collector (get_collector_health)

That last one matters more than it looks. A metric that "moved" because a collector stopped reporting is not news about the app at all, and saying so is the most useful answer you can give.

Rules you must follow:

Cite only what the tools returned. You may not use general knowledge about app marketing, seasonality, school terms or Uzbekistan. If a tool did not tell you, you do not know it.

Correlation is not cause, and you are looking at correlation. Write hedged: "ehtimol", "ko'rinishidan", "bilan bir vaqtda". Never assert a cause outright.

If nothing in the data plausibly explains the movement, set no_clear_driver to true and say so in the note. This is a good answer and it is expected often. Do not reach for a weak explanation to avoid it.

Write note_uz in Uzbek, Latin script, 2 to 3 sentences. Plain and direct. No marketing language, no greeting, no restating the question.`;

/**
 * The identity of a movement: which figure, and which day.
 *
 * Not the metric alone. A single run only ever finds one movement per figure,
 * so a metric key would do there, but a backfill walks a month and finds the
 * same figure moving on several days. Keyed by metric alone those collapse onto
 * one another, and a note ends up filed against the wrong day.
 */
export function movementKey(movement: { metricKey: string; date: string }): string {
  return `${movement.metricKey} ${movement.date}`;
}

/**
 * The movements worth paying a model to explain.
 *
 * Pure, and separate from the run because it is the part with a judgement in
 * it. Two filters: one for movements already explained, so a second run on the
 * same day re-reads the table instead of re-buying the same opinion, and one
 * for the daily cap, which takes them in the order the caller listed them.
 * That order is the caller's priority, not a coincidence of iteration.
 */
export function unexplained(
  movements: Movement[],
  existing: { metricKey: string; movementDate: string }[],
  limit = MAX_NOTES_PER_RUN,
): Movement[] {
  const done = new Set(
    existing.map((row) => movementKey({ metricKey: row.metricKey, date: row.movementDate })),
  );
  return movements
    .filter((movement) => !done.has(movementKey(movement)))
    .slice(0, limit);
}

/**
 * The question, with the numbers already in it.
 *
 * Stated rather than left for the model to look up: it is about to spend its
 * tool steps looking for a cause, and making it spend one re-deriving the
 * movement we already know about would be a step it does not get back.
 */
export function explainPrompt(movement: Movement): string {
  const way =
    movement.direction === "up"
      ? "up (this is good news for us)"
      : "down (this is bad news for us)";

  return [
    `Metric: ${movement.metric}`,
    `Day: ${movement.date}`,
    `Direction: ${way}`,
    `Movement: ${movement.detail}`,
    `Readings: now ${movement.magnitude.current ?? "none"}, ` +
      `before ${movement.magnitude.previous ?? "none"}`,
    "",
    "Find out what in the data lines up with this, then write the note.",
  ].join("\n");
}

/** The explainer's instructions, with the facts the team has taught. */
export function explainInstructions(facts: Parameters<typeof formatFactsBlock>[0]): string {
  return [SYSTEM_PROMPT, formatFactsBlock(facts)].filter(Boolean).join("\n\n");
}

/**
 * One movement, explained. Throws, and its caller catches per movement.
 *
 * The same loop as the chat's (claude.ts), with the differences that matter
 * here: it ends in a schema rather than in prose, it has no history, because a
 * note about downloads should not be coloured by the note about rankings that
 * preceded it, and its last step may not call a tool, so the loop cannot run
 * out mid-investigation with nothing to show.
 */
export async function explainOne(
  send: Send,
  model: string,
  movement: Movement,
  system: string,
  deadline?: number,
): Promise<{ note: MetricNote; usage: { input: number; output: number } }> {
  const { answer, usage } = await runToolLoop({
    send,
    request: { model, maxTokens: 8_000, system, effort: "medium", schema: metricNoteJsonSchema() },
    tools: ASK_TOOLS,
    messages: [{ role: "user", content: explainPrompt(movement) }],
    maxSteps: MAX_EXPLAIN_STEPS,
    answerOnLastStep: true,
    execute: (name, input) => runTool(name, clampArgs(name, input)),
    what: "the note",
    deadline,
  });
  if (answer === null) throw new Error("ran out of steps without writing a note");
  return { note: metricNoteSchema.parse(JSON.parse(answer)), usage };
}

/**
 * Explain what can be explained, store all of it, and never throw.
 *
 * The return value carries only the successes, because its one consumer is the
 * Telegram alert and a movement without a note simply goes out as it always
 * did. Failures are not lost, though: they are written to the table with their
 * error, so a movement nobody could explain reads as exactly that rather than
 * as a quiet day.
 */
export async function explainMovements(
  movements: Movement[],
  deadline = Date.now() + EXPLAIN_BUDGET_MS,
): Promise<Map<string, string>> {
  const notes = new Map<string, string>();
  if (movements.length === 0) return notes;

  try {
    const key = anthropicKey();
    // The same degradation as everywhere else: without a key the alert still
    // goes out, exactly as it did before any of this existed.
    if (!key) return notes;

    const already = await notedMovements(movements.map((movement) => movement.date));
    const todo = unexplained(movements, already);
    if (todo.length === 0) return notes;

    const model = analystModel();
    // A minute per request at most: this shares the daily cron's 300 seconds.
    const client = claudeClient(key, 60_000);
    const send: Send = (params) => client.beta.messages.create(params);

    /*
     * The team's taught facts, which is exactly the material this loop is
     * short of. A promotion nobody collected is invisible in every table here,
     * and it is the most likely honest answer to why a number moved.
     */
    const facts = await activeFacts().catch(() => []);
    const instructions = explainInstructions(facts);

    for (const movement of todo) {
      if (Date.now() >= deadline) {
        console.warn(`out of time before explaining ${movement.metricKey}`);
        break;
      }

      try {
        const { note, usage } = await explainOne(send, model, movement, instructions, deadline);
        await saveMetricNote({
          metric_key: movement.metricKey,
          movement_date: movement.date,
          direction: movement.direction,
          magnitude: movement.detail,
          status: "ok",
          note_uz: note.note_uz,
          no_clear_driver: note.no_clear_driver,
          evidence: note.evidence,
          model,
          input_tokens: usage.input,
          output_tokens: usage.output,
        });
        notes.set(movementKey(movement), note.note_uz);
      } catch (error) {
        console.error(`could not explain ${movement.metricKey}:`, error);
        await saveMetricNote({
          metric_key: movement.metricKey,
          movement_date: movement.date,
          direction: movement.direction,
          magnitude: movement.detail,
          status: "failed",
          model,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
    }
  } catch (error) {
    // The daily run must not fail because the explainer did. Whatever notes
    // were written before this point are still worth sending.
    console.error("could not write metric notes:", error);
  }

  return notes;
}
