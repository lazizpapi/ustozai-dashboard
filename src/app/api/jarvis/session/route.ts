import { issueSessionToken } from "@/lib/gate";
import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { flagEnabled } from "@/lib/jarvis/handle";
import { mintJarvisSession } from "@/lib/jarvis/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/jarvis/session — a thirty-minute CEO session for Jarvis's browser.
 *
 * Transport only; the decisions and their tests live in src/lib/jarvis/session.ts.
 * A static segment, so it wins over /api/jarvis/[tool]: that is why no analyst
 * tool may ever be called "session", which handle.test.ts checks.
 *
 * Never cached: every answer carries a fresh credential.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();

  const { status, body } = mintJarvisSession({
    enabled: flagEnabled(process.env.JARVIS_SESSIONS_ENABLED),
    issue: issueSessionToken,
    now: Date.now(),
  });
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();
  return Response.json(
    { ok: false, error: "Use POST: a session is minted, not read." },
    { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
  );
}
