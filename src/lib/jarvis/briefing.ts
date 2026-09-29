import type { Role } from "@/lib/roles";

import { toolsFor } from "./authority";
import type { JarvisResponse } from "./handle";

/**
 * The morning briefing: one request that gathers what a department would open
 * its dashboard for first, so Jarvis can summarise it in a few sentences.
 *
 * Each step is an ordinary read tool run as the caller's department, the same
 * way Jarvis reads any figure, and the plan is cut by toolsFor: a department's
 * briefing can never reach a tool its screens do not show, revenue included.
 * Steps run side by side, and one failing step leaves the rest of the
 * briefing standing, marked, rather than failing it all.
 */

export type BriefingStep = { tool: string; args: Record<string, unknown> };

const RECENT = { days: 3 };
const COMPLAINTS = { max_rating: 2, limit: 5 };

const PLANS: Record<Role, BriefingStep[]> = {
  ceo: [
    { tool: "get_latest_report", args: {} },
    { tool: "get_downloads", args: RECENT },
    { tool: "get_revenue", args: RECENT },
    { tool: "get_active_users", args: RECENT },
    { tool: "get_reviews", args: COMPLAINTS },
  ],
  marketing: [
    { tool: "get_keywords", args: {} },
    { tool: "get_chart", args: {} },
    { tool: "get_audience", args: {} },
  ],
  product: [
    { tool: "get_downloads", args: RECENT },
    { tool: "get_reviews", args: COMPLAINTS },
    { tool: "get_audience", args: {} },
  ],
  it: [
    { tool: "get_collector_health", args: {} },
    { tool: "get_latest_report", args: {} },
  ],
};

export function briefingPlan(role: Role, catalogue: readonly string[]): BriefingStep[] {
  const allowed = toolsFor(role, catalogue);
  return PLANS[role].filter((step) => allowed.includes(step.tool));
}

export type BriefingDeps = {
  plan: readonly BriefingStep[];
  clamp: (tool: string, args: Record<string, unknown>) => Record<string, unknown>;
  run: (tool: string, args: Record<string, unknown>, role: Role) => Promise<unknown>;
};

type Section =
  | { tool: string; args: Record<string, unknown>; data: unknown }
  | { tool: string; error: string };

export async function composeBriefing(role: Role, deps: BriefingDeps): Promise<JarvisResponse> {
  const settled = await Promise.allSettled(
    deps.plan.map(async (step): Promise<Section> => {
      const args = deps.clamp(step.tool, step.args);
      return { tool: step.tool, args, data: await deps.run(step.tool, args, role) };
    }),
  );
  const sections: Section[] = settled.map((outcome, index) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : {
          tool: deps.plan[index].tool,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        },
  );
  const anyData = sections.some((section) => "data" in section);
  return {
    status: anyData ? 200 : 500,
    body: anyData
      ? { ok: true, role, sections }
      : { ok: false, error: "No part of the briefing could be read.", sections },
  };
}
