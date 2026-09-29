import { clampArgs, toolNames } from "@/lib/analyst/tools";
import { runTool } from "@/lib/analyst/run-tool";
import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { roleFromHeader } from "@/lib/jarvis/authority";
import { briefingPlan, composeBriefing } from "@/lib/jarvis/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/jarvis/briefing: the morning briefing for the caller's department,
 * gathered in one request. See src/lib/jarvis/briefing.ts.
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
  const { status, body } = await composeBriefing(role, {
    plan: briefingPlan(role, toolNames()),
    clamp: clampArgs,
    run: (tool, args, asRole) => runTool(tool, args, { role: asRole }),
  });
  return Response.json(body, { status });
}
