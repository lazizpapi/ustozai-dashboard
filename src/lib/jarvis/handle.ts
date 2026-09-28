import "server-only";

import type { AskFunctionTool } from "@/lib/analyst/tools";

/**
 * What Jarvis is allowed to ask for, and what it gets back.
 *
 * Jarvis is a voice assistant running on one laptop. It cannot reach Supabase
 * and should not learn how: every figure it speaks comes from this file, which
 * delegates to the same runTool the dashboard chat and the nightly explainer
 * already use. One switch, one set of derivations, three callers. A second
 * implementation reading the tables directly would drift from the dashboard
 * within a month, and the drift would surface as Jarvis reading a different
 * revenue figure aloud than the one on the screen.
 *
 * Kept apart from the route because the route is transport — a header, a query
 * string, a status code — and this is the decision. Its dependencies are
 * passed in rather than imported so the tests can exercise dispatch without a
 * database, which is also what keeps them fast enough to run on every commit.
 *
 * Reads never write. The one writing tool the chat has (remember_fact) is not
 * in the list Jarvis is handed. The two actions, posting the analyst report or
 * a short message to the team's Telegram chat, sit behind their own switch:
 * with JARVIS_ACTIONS_ENABLED off there is no branch below that reaches a send,
 * and with it on they still take a POST. Both are properties a test checks,
 * which is the reason to spend branches on them rather than comments.
 */

export type JarvisRequest = {
  tool: string;
  method: string;
  args: Record<string, unknown>;
};

export type JarvisResponse = {
  status: number;
  body: unknown;
};

export type JarvisDeps = {
  /** The tools Jarvis may call. The route passes ASK_TOOLS, never CHAT_TOOLS. */
  readToolNames: () => string[];
  clampArgs: (tool: string, raw: unknown) => Record<string, unknown>;
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** JARVIS_ACTIONS_ENABLED. Off, or no runner, means every action is 501. */
  actionsEnabled?: boolean;
  runAction?: (tool: ActionTool, args: Record<string, unknown>) => Promise<JarvisResponse>;
};

/**
 * Things Jarvis will one day do rather than read.
 *
 * Named here while unimplemented so the answer is 501 — "not built" — rather
 * than 400 — "no such tool". The distinction matters at the other end: 400
 * sends the model looking for a different tool name, 501 tells it the thing it
 * wanted is real but unavailable, which is what it should say out loud.
 */
export const ACTION_TOOLS = ["send_telegram", "send_report"] as const;

export type ActionTool = (typeof ACTION_TOOLS)[number];

/**
 * Bring a query string back to the types the clamp expects.
 *
 * A GET delivers every value as a string, and clampArgs only recognises an
 * actual number — so without this, `?days=7` would fail the type check, fall
 * back to the default 30, and have Jarvis answer confidently about a month
 * when it was asked about a week. A wrong answer, not an error.
 *
 * Empty and whitespace values are left alone rather than converted, because
 * Number("") is 0: `?days=` would become one day and quietly answer about
 * yesterday instead of falling back to the default.
 */
function coerceNumericStrings(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const trimmed = value.trim();
    const asNumber = Number(trimmed);
    out[key] = trimmed !== "" && Number.isFinite(asNumber) ? asNumber : value;
  }
  return out;
}

/**
 * The arguments carried by a POST body, which may be empty.
 *
 * An absent body means "no arguments", not "malformed request". Most tools
 * take none at all, and a POST with nothing in it was answering 400 before the
 * dispatch below ever saw which tool had been asked for — so an action came
 * back "body must be valid JSON" rather than "not built yet".
 *
 * Anything present but not an object is still a refusal. An array or a bare
 * string is a caller bug, and reading it as empty would quietly answer with
 * default arguments instead.
 */
export function argsFromBody(
  text: string,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, args: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "body must be valid JSON" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "body must be a JSON object of arguments" };
  }
  return { ok: true, args: parsed as Record<string, unknown> };
}

/**
 * An action runs only with the switch on, and only on a POST.
 *
 * Off is today's read-only endpoint: 501, "real but unavailable", with no
 * branch below it. On, a GET still answers 405, because a GET is what a
 * prefetching proxy or a pasted link sends, and posting to the company chat
 * must take a deliberate POST. A runner that throws is a 500, never a send.
 */
async function dispatchAction(
  tool: ActionTool,
  request: JarvisRequest,
  deps: JarvisDeps,
): Promise<JarvisResponse> {
  if (!deps.actionsEnabled || !deps.runAction) {
    return {
      status: 501,
      body: { ok: false, error: `${tool} is switched off (JARVIS_ACTIONS_ENABLED)` },
    };
  }
  if (request.method !== "POST") {
    return { status: 405, body: { ok: false, error: `${tool} takes a POST` } };
  }
  try {
    return await deps.runAction(tool, request.args);
  } catch (error) {
    return {
      status: 500,
      body: { ok: false, tool, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function handleJarvis(
  request: JarvisRequest,
  deps: JarvisDeps,
): Promise<JarvisResponse> {
  const { tool } = request;

  if ((ACTION_TOOLS as readonly string[]).includes(tool)) {
    return dispatchAction(tool as ActionTool, request, deps);
  }

  const readable = deps.readToolNames();
  if (!readable.includes(tool)) {
    // The valid names go back with the refusal. The caller is a model choosing
    // tool names, and it can correct itself on the next step if it is told
    // what exists — a bare 400 just gets the same guess again.
    return {
      status: 400,
      body: { ok: false, error: `no such tool: ${tool}`, tools: readable },
    };
  }

  const args = deps.clampArgs(tool, coerceNumericStrings(request.args));

  try {
    const data = await deps.runTool(tool, args);
    // The arguments come back as used, not as asked for. Jarvis says the
    // period out loud, and after a clamp the two are different numbers.
    return { status: 200, body: { ok: true, tool, args, data } };
  } catch (error) {
    /*
     * A failing query must not return 200 with nothing in it. Jarvis would
     * read that as "revenue is nothing", which is a different sentence from
     * "I cannot reach the dashboard" and the wrong one to say to a CEO.
     *
     * The message goes back in full: the only caller holds the secret and is
     * the owner, and a bare 500 would leave a voice assistant with nothing to
     * say about why it went quiet.
     */
    return {
      status: 500,
      body: { ok: false, tool, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** One entry of the catalogue: what Jarvis turns into a Gemini function. */
export type JarvisToolEntry = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type JarvisCatalogue = {
  ok: true;
  tools: JarvisToolEntry[];
  actions: { enabled: boolean; tools: string[] };
};

/**
 * GET /api/jarvis — the health check, and the catalogue Jarvis builds its
 * tools from.
 *
 * Each entry carries its parameters, not just a name, so Jarvis can declare
 * the tool to its model exactly as the dashboard chat declares it. A tool added
 * to the chat reaches Jarvis on its next start with no change on that side.
 *
 * Only the plain JSON schema goes out. `type: "function"` and `strict` are the
 * OpenAI envelope; Gemini's schema type rejects unknown keys, and one rejected
 * declaration ends the whole voice session at connect. A tool with no
 * parameters gets an empty object schema, because the other end requires one.
 */
export function jarvisCatalogue(
  tools: readonly AskFunctionTool[],
  flags: { actionsEnabled: boolean },
): JarvisResponse {
  const body: JarvisCatalogue = {
    ok: true,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ? { ...tool.parameters } : { type: "object", properties: {} },
    })),
    actions: { enabled: flags.actionsEnabled, tools: [...ACTION_TOOLS] },
  };
  return { status: 200, body };
}

/**
 * Read a feature switch from the environment.
 *
 * Only the word "true" turns one on. Anything else, including unset, leaves it
 * off, so a deploy that forgets a variable cannot quietly hand Jarvis the power
 * to sign in or to post.
 */
export function flagEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
