import "server-only";

import OpenAI from "openai";

import { CHAT_TOOLS, clampArgs } from "./tools";
import { pagePrompt } from "./page-context";
import { formatFactsBlock } from "./memory";
import { runTool } from "./run-tool";
import { activeFacts } from "@/lib/db/queries";
import { analystModel, openaiKey } from "@/lib/env";

/**
 * Ask the analyst a question.
 *
 * A tool-use loop rather than one call: the model chooses which data it needs,
 * reads it, and can go back for more before answering. That is what lets it
 * answer questions the daily report never anticipated.
 *
 * The loop is written by hand rather than delegating to a helper that runs
 * tools for you, because every tool result has to be captured for the trace
 * the UI shows. An answer about the company's numbers should come with the
 * receipts for which numbers it read, and a helper that executes tools
 * internally would hide exactly that.
 */

const MAX_STEPS = 8;

const SYSTEM_PROMPT = `You are the analyst for Ustoz AI, an education app in Uzbekistan on the App Store and Google Play. You are answering questions from the founding team about their own app, in a chat on their internal dashboard.

You have tools that read the dashboard's database. Use them. Do not answer a factual question about the app's performance from memory or from earlier in the conversation when a tool can give you the current number. Call the tool and cite what it returns.

Call several tools when a question needs several kinds of data, and go back for more if a first look raises an obvious follow-up. Prefer reading too much to guessing.

Read the caveats in each tool's description; they describe real measurement limits. In particular, Google's install counter updates roughly once a day, so a zero daily install figure usually means the counter has not moved yet, not that nobody installed. Never report that as a collapse.

If the data cannot answer the question, say so plainly and say what would be needed. Do not fill the gap with an estimate or an industry rule of thumb. "We don't collect that" is a complete and useful answer.

Answer in the language the question was asked in. An Uzbek question gets an Uzbek answer in Latin script, a Russian question gets Russian, an English question gets English. Do not switch languages unless you are asked to.

You have a long-term memory of facts the team has taught you. When the user explicitly asks you to remember something, call remember_fact. When they tell you something durable that nobody asked you to save - a promotion they ran, a change in how they work, a season that matters to them - you may ask whether to remember it, and call remember_fact only if they say yes. Never save anything silently, and always say in your answer what you saved.

Answer in prose, briefly, leading with the answer. Give the numbers you used. Skip preamble and do not restate the question. Use short markdown only where it genuinely helps: a bullet list for several parallel figures, bold for a single key number. No headers.`;

export interface AskStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface AskResult {
  answer: string;
  steps: AskStep[];
  usage: { input: number; output: number };
}

export type AskTurn = { role: "user" | "assistant"; content: string };

export async function ask(
  question: string,
  history: AskTurn[] = [],
  page?: string,
): Promise<AskResult> {
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  // Where the question was asked from, when we recognise the page. Enough for
  // the model to read "how are we doing?" as being about what is on screen.
  const where = page ? pagePrompt(page) : null;

  /*
   * Fetched here rather than by each caller, so both surfaces get the memory
   * for free. Allowed to fail: a database hiccup should cost the assistant its
   * notes, not its answer.
   */
  const facts = await activeFacts().catch(() => []);

  const instructions = [SYSTEM_PROMPT, where, formatFactsBlock(facts)]
    .filter(Boolean)
    .join("\n\n");

  const client = new OpenAI({ apiKey: key });
  const input: OpenAI.Responses.ResponseInput = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: question },
  ];

  const steps: AskStep[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await client.responses.create({
      model: analystModel(),
      max_output_tokens: 8_000,
      instructions,
      tools: CHAT_TOOLS,
      input,
    });

    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;

    /*
     * Checked before reading any text. A refusal and a truncation both come
     * back as an ordinary success, so pulling the answer out first would
     * return an empty string and hide why.
     */
    const message = response.output.find((item) => item.type === "message");
    const refusal = message?.content.find((part) => part.type === "refusal");
    if (refusal) throw new Error(`the model declined: ${refusal.refusal}`);

    if (response.status === "incomplete") {
      throw new Error(
        `the answer was cut off (${response.incomplete_details?.reason ?? "unknown reason"})`,
      );
    }

    const calls = response.output.filter((item) => item.type === "function_call");

    if (calls.length === 0) {
      return {
        answer: response.output_text.trim(),
        steps,
        usage: { input: inputTokens, output: outputTokens },
      };
    }

    /*
     * Every output item goes back verbatim, then one result item per call.
     * All of them, not just the calls: reasoning models carry state in their
     * reasoning items, and dropping those between turns loses the thread.
     *
     * The cast narrows away a computer-use variant that the output union
     * allows but this agent cannot produce, since the only tools it is given
     * are the read-only functions in tools.ts.
     */
    input.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));

    for (const call of calls) {
      // Arguments arrive as a JSON string, and a malformed one is the model's
      // mistake to recover from rather than ours to crash on.
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(call.arguments || "{}");
      } catch {
        parsed = {};
      }

      const args = clampArgs(call.name, parsed);
      steps.push({ tool: call.name, args });

      try {
        const data = await runTool(call.name, args, {
          surface: page === "/telegram" ? "telegram" : "chat",
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(data),
        });
      } catch (error) {
        // Handed back to the model rather than thrown, so one dead query
        // becomes something it can work around instead of losing the answer.
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      }
    }
  }

  return {
    answer:
      "I went round in circles on that one and stopped before running up a bill. " +
      "Try asking it in a narrower way.",
    steps,
    usage: { input: inputTokens, output: outputTokens },
  };
}
