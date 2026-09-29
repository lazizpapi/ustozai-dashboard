import { randomBytes } from "node:crypto";

import { currentRole, currentScope } from "@/app/load";
import { liveKitConfigFrom, mintCallToken } from "@/lib/jarvis/call-token";

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
 * Never cached: every answer carries a fresh credential.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  const { status, body } = await mintCallToken({
    role: await currentRole(),
    scope: await currentScope(),
    config: liveKitConfigFrom(process.env),
    suffix: randomBytes(4).toString("hex"),
  });
  return Response.json(body, { status, headers: NO_STORE });
}
