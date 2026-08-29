import { ask, type AskTurn } from "@/lib/analyst/ask";
import {
  formatFactsList,
  parseMemoryCommand,
  type MemoryCommand,
} from "@/lib/analyst/memory";
import { activeFacts } from "@/lib/db/queries";
import { deactivateAgentFact, saveAgentFact } from "@/lib/db/persist";
import { currentRole } from "@/app/load";
import { openaiKey } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The chat endpoint.
 *
 * Not behind the cron secret: this one is reached by a signed-in person, and
 * proxy.ts already gates every route except /api/cron and /api/webhook behind
 * the dashboard session.
 *
 * A session is not enough here, though, and this is the one endpoint where
 * that matters. proxy.ts asks only whether the cookie is valid, not whose it
 * is, while the layout mounts the chat for the CEO alone on the grounds that
 * the agent can read every table and a department would be handed the figures
 * its own dashboard withholds. Hiding the control was never the check: a
 * marketing session could post here directly. So the role is verified in the
 * one place a caller cannot skip, and the tools that read the company
 * finances exist only behind it.
 *
 * The conversation lives in the browser and is posted back each turn. That
 * keeps questions about the company's numbers out of the database, and means
 * there is no chat history to leak or to have to expire.
 */

const MAX_QUESTION = 2_000;
const MAX_HISTORY = 20;

export async function POST(request: Request) {
  /*
   * Ahead of the key check on purpose. Which roles may ask is a property of
   * the deployment, and answering "the analyst needs a key" to a caller who
   * may not ask at all would confirm the endpoint exists and works.
   */
  if ((await currentRole()) !== "ceo") {
    return Response.json({ error: "Not available for this account." }, { status: 403 });
  }

  if (!openaiKey()) {
    return Response.json(
      { error: "The analyst needs OPENAI_API_KEY set in the environment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body is not JSON." }, { status: 400 });
  }

  const { question, history, page } = (body ?? {}) as {
    question?: unknown;
    history?: unknown;
    page?: unknown;
  };

  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION) {
    return Response.json({ error: "That question is too long." }, { status: 400 });
  }

  /*
   * Memory commands never reach the model.
   *
   * Same contract as Telegram: "remember: ..." stores that sentence exactly,
   * and a model asked to do the storing would be a model deciding what the
   * sentence meant. Shaped like an ordinary answer with an empty trace, so the
   * dock renders it without knowing this path exists.
   */
  const memory = parseMemoryCommand(question);
  if (memory) {
    const answer = await runMemoryCommand(memory);
    return Response.json({ answer, steps: [], usage: { input: 0, output: 0 } });
  }

  // Trimmed to the recent turns: an unbounded history posted from the browser
  // is both a cost and a request-size problem, and the older turns rarely
  // change the answer to the current question.
  const turns: AskTurn[] = Array.isArray(history)
    ? history
        .filter(
          (turn): turn is AskTurn =>
            !!turn &&
            typeof turn === "object" &&
            (turn as AskTurn).role !== undefined &&
            typeof (turn as AskTurn).content === "string" &&
            ((turn as AskTurn).role === "user" || (turn as AskTurn).role === "assistant"),
        )
        .slice(-MAX_HISTORY)
    : [];

  // Which page the question was asked from. Dropped rather than rejected if
  // it looks wrong: it only sharpens the answer, so a malformed value should
  // cost the context, not the question.
  const from =
    typeof page === "string" && page.startsWith("/") && page.length <= 100
      ? page
      : undefined;

  try {
    const result = await ask(question.trim(), turns, from);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * A memory command, carried out and reported in plain words.
 *
 * Returns the sentence the dock will show rather than a status, because every
 * one of these is something a person is waiting to be told: what was saved,
 * what is remembered, what was dropped. A command that quietly did nothing is
 * the failure worth avoiding here.
 */
async function runMemoryCommand(memory: MemoryCommand): Promise<string> {
  try {
    if (memory.kind === "remember") {
      await saveAgentFact(memory.fact, "chat");
      return `Saved: ${memory.fact}`;
    }

    const facts = await activeFacts();

    if (memory.kind === "facts") return formatFactsList(facts);

    // Shows the list rather than guessing which one was meant. Deleting the
    // wrong fact is not something the next command can undo.
    if (memory.index === null || memory.index > facts.length) {
      return formatFactsList(facts);
    }

    const target = facts[memory.index - 1];
    await deactivateAgentFact(target.id);
    return `Forgotten: ${target.fact}`;
  } catch (error) {
    console.error("could not handle a memory command:", error);
    return "I could not reach my memory just now. Try again in a moment.";
  }
}
