import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { clearJarvisNote, saveJarvisNote } from "@/lib/db/persist";
import { openJarvisNotes } from "@/lib/db/queries";
import { roleFromHeader } from "@/lib/jarvis/authority";
import { handleNotes } from "@/lib/jarvis/notes";

export const dynamic = "force-dynamic";

/**
 * GET and POST /api/jarvis/notes: a department's notes and reminders.
 *
 * Transport only; the rules and their tests live in src/lib/jarvis/notes.ts.
 * A static segment, so it wins over /api/jarvis/[tool], which is why no
 * analyst tool may be called "notes" (handle.test.ts checks).
 */

const DEPS = { list: openJarvisNotes, save: saveJarvisNote, clear: clearJarvisNote };

async function respond(request: Request, body: unknown) {
  const role = roleFromHeader(request.headers.get("x-jarvis-role"));
  const { status, body: answer } = await handleNotes({ role, method: request.method, body }, DEPS);
  return Response.json(answer, { status });
}

export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();
  return respond(request, {});
}

export async function POST(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body must be valid JSON" }, { status: 400 });
  }
  return respond(request, body);
}
