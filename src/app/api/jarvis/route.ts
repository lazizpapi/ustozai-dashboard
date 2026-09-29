import { ASK_TOOLS, type AskFunctionTool } from "@/lib/analyst/tools";
import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { postingRolesFrom, roleFromHeader } from "@/lib/jarvis/authority";
import { flagEnabled, jarvisCatalogue } from "@/lib/jarvis/handle";

export const dynamic = "force-dynamic";

/**
 * What Jarvis can ask for.
 *
 * Two jobs. It is the health check — one authenticated GET that proves the
 * secret is right and the deployment is up without running a query — and it is
 * the catalogue Jarvis builds its tools from, parameters included, so the tools
 * it offers its model are the ones that actually exist rather than assumed. A tool renamed here and
 * not there would otherwise surface as Jarvis saying it cannot find something
 * that is sitting on the dashboard.
 *
 * Authenticated like everything else under /api/jarvis: the tool descriptions
 * name the company's metrics and are not worth publishing.
 *
 * Cut to the caller: X-Jarvis-Role says which department is on the call, and
 * the catalogue lists only that department's tools and pages.
 */
export async function GET(request: Request) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();

  const { status, body } = jarvisCatalogue(ASK_TOOLS as AskFunctionTool[], {
    actionsEnabled: flagEnabled(process.env.JARVIS_ACTIONS_ENABLED),
    role: roleFromHeader(request.headers.get("x-jarvis-role")),
    postingRoles: postingRolesFrom(process.env.JARVIS_POSTING_ROLES),
  });
  return Response.json(body, { status });
}
