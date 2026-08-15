import { ask, type AskTurn } from "@/lib/analyst/ask";
import { anthropicKey } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The chat endpoint.
 *
 * Not behind the cron secret: this one is reached by a signed-in person, and
 * proxy.ts already gates every route except /api/cron and /api/webhook behind
 * the dashboard session. Adding a second check here would be theatre.
 *
 * The conversation lives in the browser and is posted back each turn. That
 * keeps questions about the company's numbers out of the database, and means
 * there is no chat history to leak or to have to expire.
 */

const MAX_QUESTION = 2_000;
const MAX_HISTORY = 20;

export async function POST(request: Request) {
  if (!anthropicKey()) {
    return Response.json(
      { error: "The analyst needs ANTHROPIC_API_KEY set in the environment." },
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
