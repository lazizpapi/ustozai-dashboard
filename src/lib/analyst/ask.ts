import "server-only";

import { CHAT_TOOLS, clampArgs } from "./tools";
import { pagePrompt } from "./page-context";
import { formatFactsBlock } from "./memory";
import { runTool } from "./run-tool";
import { activeFacts } from "@/lib/db/queries";
import { analystModel, anthropicKey } from "@/lib/env";
import { claudeClient, conversation, runToolLoop, type Turn } from "./claude";
import { UZBEK_SPELLING } from "./uzbek";

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

Answer in the language the question was asked in. An Uzbek question gets an Uzbek answer in Latin script, a Russian question gets Russian, an English question gets English. Do not switch languages unless you are asked to. ${UZBEK_SPELLING}

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

export type AskTurn = Turn;

/** What the chat says when it ran out of steps rather than answer from a guess. */
const GAVE_UP =
  "I went round in circles on that one and stopped before running up a bill. " +
  "Try asking it in a narrower way.";

export async function ask(
  question: string,
  history: AskTurn[] = [],
  page?: string,
): Promise<AskResult> {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  // Where the question was asked from, when we recognise the page. Enough for
  // the model to read "how are we doing?" as being about what is on screen.
  const where = page ? pagePrompt(page) : null;

  /*
   * Fetched here rather than by each caller, so both surfaces get the memory
   * for free. Allowed to fail: a database hiccup should cost the assistant its
   * notes, not its answer.
   */
  const facts = await activeFacts().catch(() => []);

  const system = [SYSTEM_PROMPT, where, formatFactsBlock(facts)]
    .filter(Boolean)
    .join("\n\n");

  const client = claudeClient(key);
  const steps: AskStep[] = [];
  const { answer, usage } = await runToolLoop({
    send: (params) => client.beta.messages.create(params),
    // Medium effort: a chat answer is a few tool reads, not a hard problem, and
    // the person is waiting for it.
    request: { model: analystModel(), maxTokens: 16_000, system, effort: "medium" },
    tools: CHAT_TOOLS,
    messages: conversation(history, question),
    maxSteps: MAX_STEPS,
    // The last step answers from what was read rather than asking for more.
    answerOnLastStep: true,
    execute: (name, input) => {
      // Recorded as clamped, so the trace shows what was actually read.
      const args = clampArgs(name, input);
      steps.push({ tool: name, args });
      return runTool(name, args, { surface: page === "/telegram" ? "telegram" : "chat" });
    },
  });

  return { answer: answer ?? GAVE_UP, steps, usage };
}
