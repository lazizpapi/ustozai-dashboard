import { ASK_TOOLS, type AskFunctionTool } from "@/lib/analyst/tools";
import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { ACTION_TOOLS } from "@/lib/jarvis/handle";

export const dynamic = "force-dynamic";

/**
 * What Jarvis can ask for.
 *
 * Two jobs. It is the health check — one authenticated GET that proves the
 * secret is right and the deployment is up without running a query — and it is
 * the catalogue, so the tool names Jarvis knows about can be checked against
 * the ones that actually exist rather than assumed. A tool renamed here and
 * not there would otherwise surface as Jarvis saying it cannot find something
 * that is sitting on the dashboard.
 *
 * Authenticated like everything else under /api/jarvis: the tool descriptions
 * name the company's metrics and are not worth publishing.
 */
export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();

  return Response.json({
    ok: true,
    tools: (ASK_TOOLS as AskFunctionTool[]).map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    })),
    actions: { enabled: false, tools: [...ACTION_TOOLS] },
  });
}
