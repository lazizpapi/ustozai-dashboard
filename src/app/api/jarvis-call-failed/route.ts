import { currentRole, currentScope } from "@/app/load";
import { saveJarvisCall } from "@/lib/db/persist";
import { jarvisCallLogged, jarvisFailedCallsSince } from "@/lib/db/queries";
import { recordFailedCall } from "@/lib/jarvis/failed-calls";

export const dynamic = "force-dynamic";

/**
 * POST /api/jarvis-call-failed — the call screen reports a call that never got
 * going, so it shows on the Calls page.
 *
 * Transport only; the checks and their tests live in
 * src/lib/jarvis/failed-calls.ts. Like /api/jarvis-token, it is for a person
 * and takes their session cookie, so it sits outside /api/jarvis/, which is
 * the agent's and takes a bearer secret.
 */

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // An unreadable report is refused by the checks like any other bad one.
  }
  const [role, scope] = await Promise.all([currentRole(), currentScope()]);
  const { status, body: answer } = await recordFailedCall({
    role,
    scope,
    body,
    now: new Date(),
    alreadyLogged: jarvisCallLogged,
    failuresLately: jarvisFailedCallsSince,
    save: saveJarvisCall,
  });
  return Response.json(answer, { status, headers: { "Cache-Control": "no-store" } });
}
