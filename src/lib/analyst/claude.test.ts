import type {
  BetaMessage,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it, vi } from "vitest";

import { FALLBACK_BETA, claudeRequest, claudeTools, conversation, finishedText, runToolLoop } from "./claude";
import type { AskFunctionTool } from "./tools";

/**
 * The one way the dashboard talks to Claude: the daily report, the notes on
 * why a number moved, and the chat all go through these. Moved off OpenAI in
 * October 2026, when its account had been out of credits for three weeks.
 */

const TOOL: AskFunctionTool = {
  type: "function",
  name: "get_downloads",
  description: "Daily downloads.",
  strict: false,
  parameters: { type: "object", properties: { days: { type: "number" } } },
};

const REQUEST = { model: "claude-sonnet-5-5", maxTokens: 16_000, system: "You are the analyst.", effort: "medium" as const };

function reply(content: unknown[], stop: string, usage = { input_tokens: 10, output_tokens: 5 }): BetaMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: stop,
    stop_details: null,
    usage,
  } as unknown as BetaMessage;
}

const said = (text: string) => ({ type: "text", text });
const calls = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const thought = { type: "thinking", thinking: "", signature: "sig" };

function scripted(...replies: BetaMessage[]) {
  const sent: BetaMessageCreateParamsNonStreaming[] = [];
  const send = vi.fn(async (params: BetaMessageCreateParamsNonStreaming) => {
    sent.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("no reply scripted");
    return next;
  });
  return { send, sent };
}

describe("claudeTools", () => {
  it("hands Claude each tool's name, description and schema; the catalogue keeps its own shape", () => {
    expect(claudeTools([TOOL])).toEqual([
      {
        name: "get_downloads",
        description: "Daily downloads.",
        input_schema: { type: "object", properties: { days: { type: "number" } } },
      },
    ]);
  });
});

describe("claudeRequest", () => {
  it("asks for Sonnet 5.5 at the given effort, retries a declined request on a fallback, and caches the prefix", () => {
    expect(claudeRequest(REQUEST)).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: "You are the analyst.",
      output_config: { effort: "medium" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
    });
  });

  it("skips the cache for a request made once a day, where writing it only costs more", () => {
    expect(claudeRequest({ ...REQUEST, cache: false })).not.toHaveProperty("cache_control");
  });

  it("holds the answer to a JSON schema when given one", () => {
    const schema = { type: "object", properties: {}, additionalProperties: false };
    expect(claudeRequest({ ...REQUEST, schema }).output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema },
    });
  });
});

describe("finishedText", () => {
  it("joins the answer's text and leaves out its thinking", () => {
    expect(finishedText(reply([thought, said("Downloads "), said("rose.")], "end_turn"), "the answer")).toBe(
      "Downloads rose.",
    );
  });

  it("keeps only the fallback model's answer when a declined answer was handed over mid-way", () => {
    // The declining model's partial text comes before the fallback block; glued
    // to the full answer it would break the report's JSON.
    const handedOver = reply(
      [said('{"half'), { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } }, said('{"whole": true}')],
      "end_turn",
    );
    expect(finishedText(handedOver, "the report")).toBe('{"whole": true}');
  });

  it("calls an answer with no text a failure, not a blank reply", () => {
    expect(() => finishedText(reply([thought], "end_turn"), "the answer")).toThrow("the answer came back empty");
  });

  it("says plainly when Claude declined or was cut off, rather than returning an empty answer", () => {
    const declined = { ...reply([], "refusal"), stop_details: { type: "refusal", category: "cyber", explanation: null } };
    expect(() => finishedText(declined as BetaMessage, "the report")).toThrow("the model declined the report (cyber)");
    expect(() => finishedText(reply([said("half")], "max_tokens"), "the report")).toThrow(
      "the report was cut off (max_tokens)",
    );
  });
});

describe("runToolLoop", () => {
  it("returns a direct answer, with what it cost", async () => {
    const { send } = scripted(reply([said("Hello.")], "end_turn"));
    const result = await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Hi" }],
      maxSteps: 8,
      execute: async () => ({}),
    });
    expect(result).toEqual({ answer: "Hello.", usage: { input: 10, output: 5 } });
  });

  it("runs every tool Claude asks for, sends all the results back in one turn, then answers", async () => {
    const asked = reply([thought, calls("t1", "get_downloads", { days: 7 }), calls("t2", "get_downloads", { days: 30 })], "tool_use");
    const { send, sent } = scripted(asked, reply([said("Up 12%.")], "end_turn"));
    const execute = vi.fn(async (_name: string, input: unknown) => ({ seen: input }));

    const result = await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Downloads?" }],
      maxSteps: 8,
      execute,
    });

    expect(execute.mock.calls).toEqual([
      ["get_downloads", { days: 7 }],
      ["get_downloads", { days: 30 }],
    ]);
    // The assistant turn goes back exactly as it came, thinking included.
    expect(sent[1].messages[1]).toEqual({ role: "assistant", content: asked.content });
    expect(sent[1].messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ seen: { days: 7 } }) },
        { type: "tool_result", tool_use_id: "t2", content: JSON.stringify({ seen: { days: 30 } }) },
      ],
    });
    expect(result).toEqual({ answer: "Up 12%.", usage: { input: 20, output: 10 } });
  });

  it("counts input read from or written to the cache, not just the uncached tail", async () => {
    const usage = { input_tokens: 4, output_tokens: 5, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200 };
    const { send } = scripted(reply([said("Hi.")], "end_turn", usage as never));
    const result = await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Hi" }],
      maxSteps: 8,
      execute: async () => ({}),
    });
    expect(result.usage).toEqual({ input: 3204, output: 5 });
  });

  it("stops before a step that would start past its deadline", async () => {
    const { send } = scripted(reply([calls("t1", "get_downloads", {})], "tool_use"), reply([said("late")], "end_turn"));
    let now = 1_000;
    await expect(
      runToolLoop({
        send,
        request: REQUEST,
        tools: [TOOL],
        messages: [{ role: "user", content: "Why?" }],
        maxSteps: 5,
        deadline: 1_500,
        now: () => now,
        execute: async () => {
          now = 2_000;
          return {};
        },
        what: "the note",
      }),
    ).rejects.toThrow("ran out of time before finishing the note");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("hands a failed tool back as an error Claude can work around", async () => {
    const { send, sent } = scripted(
      reply([calls("t1", "get_downloads", {})], "tool_use"),
      reply([said("That table is down.")], "end_turn"),
    );
    await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Downloads?" }],
      maxSteps: 8,
      execute: async () => {
        throw new Error("relation does not exist");
      },
    });
    expect(sent[1].messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: JSON.stringify({ error: "relation does not exist" }),
          is_error: true,
        },
      ],
    });
  });

  it("stops after the last step with no answer, so the caller decides what to say", async () => {
    const { send } = scripted(
      reply([calls("t1", "get_downloads", {})], "tool_use"),
      reply([calls("t2", "get_downloads", {})], "tool_use"),
    );
    const result = await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Downloads?" }],
      maxSteps: 2,
      execute: async () => ({}),
    });
    expect(result.answer).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("forbids tools on the last step when told to, so that step has to answer", async () => {
    const { send, sent } = scripted(
      reply([calls("t1", "get_downloads", {})], "tool_use"),
      reply([said("{}")], "end_turn"),
    );
    await runToolLoop({
      send,
      request: REQUEST,
      tools: [TOOL],
      messages: [{ role: "user", content: "Why?" }],
      maxSteps: 2,
      answerOnLastStep: true,
      execute: async () => ({}),
    });
    // The tools stay listed, because Claude refuses a request whose history
    // holds tool calls without them; tool_choice none is what stops a call.
    expect(sent[0].tool_choice).toBeUndefined();
    expect(sent[1].tools).toHaveLength(1);
    expect(sent[1].tool_choice).toEqual({ type: "none" });
  });

  it("passes a refusal up instead of looping on it", async () => {
    const declined = { ...reply([], "refusal"), stop_details: { type: "refusal", category: "general_harms", explanation: null } };
    const { send } = scripted(declined as BetaMessage);
    await expect(
      runToolLoop({
        send,
        request: REQUEST,
        tools: [TOOL],
        messages: [{ role: "user", content: "x" }],
        maxSteps: 8,
        execute: async () => ({}),
        what: "the answer",
      }),
    ).rejects.toThrow("the model declined the answer (general_harms)");
  });
});

describe("conversation", () => {
  it("is the earlier turns, then the question", () => {
    expect(
      conversation(
        [
          { role: "user", content: "Downloads?" },
          { role: "assistant", content: "Up 12%." },
        ],
        "And ratings?",
      ),
    ).toEqual([
      { role: "user", content: "Downloads?" },
      { role: "assistant", content: "Up 12%." },
      { role: "user", content: "And ratings?" },
    ]);
  });

  it("drops a leading reply and empty turns, which Claude would refuse", () => {
    expect(
      conversation(
        [
          { role: "assistant", content: "Hello, how can I help?" },
          { role: "user", content: "  " },
          { role: "user", content: "Downloads?" },
        ],
        "Thanks",
      ),
    ).toEqual([
      { role: "user", content: "Downloads?" },
      { role: "user", content: "Thanks" },
    ]);
  });
});

