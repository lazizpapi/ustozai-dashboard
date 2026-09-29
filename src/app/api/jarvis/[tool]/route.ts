import { clampArgs, toolNames } from "@/lib/analyst/tools";
import { isAuthorizedBearer, unauthorized } from "@/lib/cron-auth";
import { postingRolesFrom, roleFromHeader } from "@/lib/jarvis/authority";
import { argsFromBody, flagEnabled, handleJarvis } from "@/lib/jarvis/handle";
import { runTool } from "@/lib/analyst/run-tool";
import { latestAnalystReport } from "@/lib/db/queries";
import { sendTelegramMessage } from "@/lib/digest/telegram";
import { runJarvisAction } from "@/lib/jarvis/actions";

export const dynamic = "force-dynamic";

/**
 * Where Jarvis reads the company's numbers.
 *
 * Jarvis is a voice assistant on one laptop with no session cookie and no
 * route to Supabase, so it needs a machine-authenticated way in. This is it:
 * one tool per request, the same runTool the dashboard chat uses, JSON out.
 *
 * Transport only. Which tools exist, what their arguments may be and what
 * happens when one fails all live in src/lib/jarvis/handle.ts, which is where
 * the tests are, because they can run there without a database.
 *
 * ASK_TOOLS, deliberately, not CHAT_TOOLS: the chat's one writing tool
 * (remember_fact) is not reachable from here. The two Telegram actions are,
 * but only while JARVIS_ACTIONS_ENABLED is on, only on a POST, and only for a
 * department named in JARVIS_POSTING_ROLES (the CEO by default).
 *
 * X-Jarvis-Role says which department is on the call; handleJarvis refuses
 * anything outside it.
 */

/** Where the report links to, the same address the nightly analyst uses. */
function reportUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return base ? `${base}/analyst` : undefined;
}

function toolList(): string[] {
  return toolNames();
}

async function respond(request: Request, tool: string, args: Record<string, unknown>) {
  if (!isAuthorizedBearer(request, process.env.JARVIS_SECRET)) return unauthorized();

  const { status, body } = await handleJarvis(
    { role: roleFromHeader(request.headers.get("x-jarvis-role")), tool, method: request.method, args },
    {
      readToolNames: toolList,
      clampArgs,
      runTool: (name, toolArgs, role) => runTool(name, toolArgs, { role }),
      actionsEnabled: flagEnabled(process.env.JARVIS_ACTIONS_ENABLED),
      postingRoles: postingRolesFrom(process.env.JARVIS_POSTING_ROLES),
      runAction: (action, actionArgs) =>
        runJarvisAction(action, actionArgs, {
          latestReport: latestAnalystReport,
          send: (text) => sendTelegramMessage(text),
          reportUrl: reportUrl(),
        }),
    },
  );
  return Response.json(body, { status });
}

export async function GET(request: Request, context: { params: Promise<{ tool: string }> }) {
  const { tool } = await context.params;
  // Every value arrives as a string here; handleJarvis puts the numbers back.
  const args = Object.fromEntries(new URL(request.url).searchParams.entries());
  return respond(request, tool, args);
}

export async function POST(request: Request, context: { params: Promise<{ tool: string }> }) {
  const { tool } = await context.params;

  // The body is the argument object itself; there is no envelope. An empty
  // body means no arguments, which most tools take.
  const parsed = argsFromBody(await request.text());
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

  return respond(request, tool, parsed.args);
}
