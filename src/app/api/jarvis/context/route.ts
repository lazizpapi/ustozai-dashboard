import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { reportOutage } from "@/lib/analyst/outage";
import { jarvisCallsFor, openJarvisNotes, recentAnalystRunStatuses } from "@/lib/db/queries";
import { roleFromHeader } from "@/lib/jarvis/authority";
import { gatherCallContext } from "@/lib/jarvis/context";

export const dynamic = "force-dynamic";

/**
 * GET /api/jarvis/context: what Jarvis should know as a department's call
 * begins. Its last few calls, whether this is its first call today, the
 * reminders that have come due, and for the CEO and IT whether the daily
 * report has stopped. See src/lib/jarvis/context.ts.
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
  const { status, body } = await gatherCallContext(role, {
    now: new Date(),
    calls: (asRole) => jarvisCallsFor(asRole),
    notes: openJarvisNotes,
    reportOutage: async () => reportOutage(await recentAnalystRunStatuses()),
  });
  return Response.json(body, { status });
}
