import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { saveJarvisCall } from "@/lib/db/persist";
import { recordJarvisCall } from "@/lib/jarvis/calls";

export const dynamic = "force-dynamic";

/**
 * POST /api/jarvis/calls — the record Jarvis leaves when a call ends.
 *
 * Transport only; the checks and their tests live in src/lib/jarvis/calls.ts.
 * A static segment, so it wins over /api/jarvis/[tool]: that is why no analyst
 * tool may ever be called "calls", which handle.test.ts checks.
 */

export async function POST(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body must be valid JSON" }, { status: 400 });
  }

  const { status, body: answer } = await recordJarvisCall(body, saveJarvisCall);
  return Response.json(answer, { status });
}

export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();
  return Response.json(
    { ok: false, error: "Use POST: a call record is written here, and read on /calls." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
