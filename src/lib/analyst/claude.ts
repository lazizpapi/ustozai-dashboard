import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { AskFunctionTool } from "./tools";

/**
 * The one way the dashboard talks to Claude.
 *
 * The daily report, the note on why a number moved, and the chat (on the
 * dashboard and in the team's Telegram group) all go through here. They ran on
 * OpenAI until October 2026, when that account had been out of credits for
 * three weeks and every one of them had been failing daily.
 *
 * Kept small and free of the database, so the loop can be tested with a
 * scripted reply in place of the API.
 */

/** Server-side fallback: a declined request is retried on a fallback model inside the same call. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high";

export type ClaudeRequest = {
  model: string;
  maxTokens: number;
  system: string;
  effort: Effort;
  /** A JSON schema the answer must match, for answers the code reads rather than a person. */
  schema?: Record<string, unknown>;
  /** Off for a request made once a day, where writing the cache only costs more. */
  cache?: boolean;
};

export type Send = (params: BetaMessageCreateParamsNonStreaming) => Promise<BetaMessage>;

/** timeoutMs bounds each request, for callers working inside a deadline. */
export function claudeClient(apiKey: string, timeoutMs?: number): Anthropic {
  return new Anthropic({ apiKey, ...(timeoutMs ? { timeout: timeoutMs, maxRetries: 1 } : {}) });
}

/**
 * Our tools as Claude takes them. The list itself keeps its own shape, because
 * Jarvis reads the same catalogue (src/lib/jarvis/handle.ts).
 */
export function claudeTools(tools: readonly AskFunctionTool[]): BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.parameters ?? { type: "object", properties: {} }) as BetaTool["input_schema"],
  }));
}

/**
 * Everything every request carries. Thinking is left at its default, adaptive,
 * and effort sets how much of it. The system prompt and tools are the same on
 * every step of a loop, so caching them makes the later steps cheaper.
 */
export function claudeRequest(request: ClaudeRequest): Omit<BetaMessageCreateParamsNonStreaming, "messages"> {
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    output_config: {
      effort: request.effort,
      ...(request.schema ? { format: { type: "json_schema" as const, schema: request.schema } } : {}),
    },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    ...(request.cache === false ? {} : { cache_control: { type: "ephemeral" as const } }),
  };
}

export type Turn = { role: "user" | "assistant"; content: string };

/**
 * The earlier turns, then the question. Claude refuses a conversation that
 * opens with its own reply or holds an empty turn, so those are left out.
 */
export function conversation(history: readonly Turn[], question: string): BetaMessageParam[] {
  const turns = history.filter((turn) => turn.content.trim() !== "");
  const firstQuestion = turns.findIndex((turn) => turn.role === "user");
  const kept = firstQuestion === -1 ? [] : turns.slice(firstQuestion);
  return [
    ...kept.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: question },
  ];
}

/**
 * The answer's text, after checking it is a whole answer. A refusal and a
 * truncation both arrive as a normal reply, so reading the text first would
 * hand back an empty or half answer and hide why.
 */
export function finishedText(message: BetaMessage, what: string): string {
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    throw new Error(`the model declined ${what}${category ? ` (${category})` : ""}`);
  }
  if (message.stop_reason === "max_tokens") throw new Error(`${what} was cut off (max_tokens)`);
  // After a fallback, only the model that finished counts: the one that
  // declined may have started an answer before the handover.
  const handover = message.content.findLastIndex((block) => block.type === "fallback");
  const text = message.content
    .slice(handover + 1)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
  if (!text) throw new Error(`${what} came back empty`);
  return text;
}

/** All the input a reply was charged for, the cached part included. */
function inputTokens(usage: BetaMessage["usage"]): number {
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

export type LoopResult = {
  /** Null when the steps ran out before an answer. */
  answer: string | null;
  usage: { input: number; output: number };
};

/**
 * Claude reads what it needs through our tools, then answers.
 *
 * Written out rather than left to the SDK's runner, because the chat shows
 * which tools were read and with what, and execute is where it records them.
 * A failed tool goes back as an error rather than ending the loop: one dead
 * query is something the model can work around.
 */
export async function runToolLoop(options: {
  send: Send;
  request: ClaudeRequest;
  tools: readonly AskFunctionTool[];
  messages: BetaMessageParam[];
  maxSteps: number;
  /** Forbid tools on the last step, so it has to answer from what it read. */
  answerOnLastStep?: boolean;
  execute: (name: string, input: unknown) => Promise<unknown>;
  /** What is being written, for the error when it is declined or cut off. */
  what?: string;
  /** No step starts after this moment (milliseconds, as now() counts them). */
  deadline?: number;
  /** The clock, for the tests. */
  now?: () => number;
}): Promise<LoopResult> {
  const what = options.what ?? "the answer";
  const tools = claudeTools(options.tools);
  const messages = [...options.messages];
  const usage = { input: 0, output: 0 };

  const now = options.now ?? Date.now;
  for (let step = 0; step < options.maxSteps; step += 1) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      throw new Error(`ran out of time before finishing ${what}`);
    }
    const last = step === options.maxSteps - 1;
    const response = await options.send({
      ...claudeRequest(options.request),
      tools,
      // Not by leaving the tools out: Claude refuses a history of tool calls
      // without them. tool_choice none keeps them listed but unusable.
      ...(last && options.answerOnLastStep ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    usage.input += inputTokens(response.usage);
    usage.output += response.usage.output_tokens;

    const toolCalls = response.content.filter((block) => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolCalls.length === 0) {
      return { answer: finishedText(response, what), usage };
    }

    // Back exactly as it came: thinking blocks are only valid unchanged.
    messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
    const results: BetaToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      try {
        const data = await options.execute(call.name, call.input);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(data) });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          is_error: true,
        });
      }
    }
    // All results in one turn: split across turns, the model stops calling tools in parallel.
    messages.push({ role: "user", content: results });
  }

  return { answer: null, usage };
}
