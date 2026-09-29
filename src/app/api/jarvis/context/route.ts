import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { jarvisCallsFor, openJarvisNotes } from "@/lib/db/queries";
import { roleFromHeader } from "@/lib/jarvis/authority";
import { callContext } from "@/lib/jarvis/context";

export const dynamic = "force-dynamic";

/**
 * GET /api/jarvis/context: what Jarvis should know as a department's call
 * begins. Its last few calls, whether this is its first call today, and the
 * reminders that have come due. See src/lib/jarvis/context.ts.
 */
export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();
  const role = roleFromHeader(request.headers.get("x-jarvis-role"));
  if (!role) {
    return Response.json(
      { ok: false, error: "X-Jarvis-Role is required: say which department is asking." },
      { status: 403 },
    );
  }
  try {
    const [calls, notes] = await Promise.all([jarvisCallsFor(role), openJarvisNotes(role)]);
    return Response.json({ ok: true, ...callContext({ now: new Date(), calls, notes }) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
