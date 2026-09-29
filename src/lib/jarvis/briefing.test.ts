import { describe, expect, it, vi } from "vitest";

import { ROLES } from "@/lib/roles";

import { toolsFor } from "./authority";
import { briefingPlan, composeBriefing } from "./briefing";

const EVERY_TOOL = [
  "get_downloads",
  "get_market",
  "get_chart",
  "get_conversion_funnel",
  "get_keywords",
  "get_reviews",
  "get_audience",
  "get_growth",
  "get_listing_changes",
  "get_latest_report",
  "get_revenue",
  "get_active_users",
  "get_instagram",
  "get_metric_notes",
  "get_collector_health",
];

const names = (role: (typeof ROLES)[number]) => briefingPlan(role, EVERY_TOOL).map((s) => s.tool);

describe("briefingPlan", () => {
  it("gives the CEO the report, the money, the installs and the complaints", () => {
    expect(names("ceo")).toEqual(
      expect.arrayContaining([
        "get_latest_report",
        "get_revenue",
        "get_downloads",
        "get_active_users",
        "get_reviews",
      ]),
    );
  });

  it.each(ROLES)("never goes beyond what %s may read", (role) => {
    const allowed = toolsFor(role, EVERY_TOOL);
    expect(names(role).every((tool) => allowed.includes(tool))).toBe(true);
    expect(names(role).length).toBeGreaterThan(0);
  });

  it("looks for complaints across many recent reviews, not only the latest few", () => {
    // get_reviews takes the newest reviews first and filters by rating after,
    // so a small limit would miss yesterday's one-star review behind five
    // happy ones and report no complaints at all.
    for (const role of ["ceo", "product"] as const) {
      const step = briefingPlan(role, EVERY_TOOL).find((s) => s.tool === "get_reviews");
      expect(step?.args).toMatchObject({ max_rating: 2 });
      expect(Number(step?.args.limit)).toBeGreaterThanOrEqual(50);
    }
  });

  it("keeps revenue out of every department's briefing", () => {
    for (const role of ["marketing", "product", "it"] as const) {
      expect(names(role)).not.toContain("get_revenue");
    }
  });

  it("drops a step whose tool the dashboard no longer has", () => {
    const withoutReports = EVERY_TOOL.filter((tool) => tool !== "get_latest_report");
    expect(briefingPlan("it", withoutReports).map((s) => s.tool)).toEqual(["get_collector_health"]);
  });
});

describe("composeBriefing", () => {
  it("runs every step as the caller's department and returns what each found", async () => {
    const run = vi.fn(async (tool: string) => ({ from: tool }));
    const result = await composeBriefing("it", {
      plan: briefingPlan("it", EVERY_TOOL),
      clamp: (_tool, args) => args,
      run,
    });
    expect(run).toHaveBeenCalledWith("get_collector_health", {}, "it");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      sections: [
        { tool: "get_collector_health", data: { from: "get_collector_health" } },
        { tool: "get_latest_report", data: { from: "get_latest_report" } },
      ],
    });
  });

  it("keeps the rest of the briefing when one step fails, and says which", async () => {
    const run = vi.fn(async (tool: string) => {
      if (tool === "get_latest_report") throw new Error("no report yet");
      return { fine: true };
    });
    const result = await composeBriefing("it", {
      plan: briefingPlan("it", EVERY_TOOL),
      clamp: (_tool, args) => args,
      run,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      sections: [{ tool: "get_collector_health" }, { tool: "get_latest_report", error: "no report yet" }],
    });
  });

  it("fails as a whole only when every step failed", async () => {
    const result = await composeBriefing("it", {
      plan: briefingPlan("it", EVERY_TOOL),
      clamp: (_tool, args) => args,
      run: async () => {
        throw new Error("database is down");
      },
    });
    expect(result.status).toBe(500);
  });
});
