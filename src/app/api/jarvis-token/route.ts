import { randomBytes } from "node:crypto";

import { currentRole, currentScope } from "@/app/load";
import { callerWishes, liveKitConfigFrom, mintCallToken } from "@/lib/jarvis/call-token";
import { readMonthUsage } from "@/lib/jarvis/month-budget";

export const dynamic = "force-dynamic";

/**
 * POST /api/jarvis-token — the token that lets a signed-in person talk to Jarvis.
 *
 * Transport only; the decisions and their tests live in
 * src/lib/jarvis/call-token.ts. The session cookie says who is asking, and the
 * department goes into the signed token, where the agent reads it.
 *
 * Outside /api/jarvis/ on purpose: those routes are for the agent and take a
 * bearer secret, this one is for a person and takes their session.
 *
 * The call screen may send the caller's chosen language and first name; the
 * department always comes from the cookie. Once the month's free agent
 * minutes are spent the answer is 429, with a sentence the screen shows.
 *
 * Never cached: every answer carries a fresh credential.
 */

const NO_STORE = { "Cache-Control": "no-store" };

/** The call screen's token request; an empty or unreadable one asks for nothing. */
async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const [role, scope, body] = await Promise.all([currentRole(), currentScope(), requestBody(request)]);
  const { status, body: answer } = await mintCallToken({
    role,
    scope,
    config: liveKitConfigFrom(process.env),
    suffix: randomBytes(4).toString("hex"),
    // Only the caller's language and first name are read from the request.
    wishes: callerWishes(body),
    minutesUsed: role ? ((await readMonthUsage())?.used ?? null) : null,
  });
  return Response.json(answer, { status, headers: NO_STORE });
}
