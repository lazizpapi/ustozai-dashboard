import { describe, expect, it } from "vitest";

import { toolNames } from "@/lib/analyst/tools";

import { mayPost, pagesFor, postingRolesFrom, roleFromHeader, toolsFor } from "./authority";
import { jarvisToolNames } from "./extra-tools";

/**
 * What Jarvis may read for whoever is talking to it.
 *
 * Jarvis answers anyone signed in to the dashboard, and each department may
 * hear only what its own screens already show. These tests pin that line
 * against the real tool list, so a tool added to the analyst later reaches
 * the CEO at once and a department only when someone grants it here.
 */

const ALL = toolNames();

describe("toolsFor", () => {
  it("gives the CEO every tool, in catalogue order", () => {
    expect(toolsFor("ceo", ALL)).toEqual(ALL);
  });

  it("gives marketing what its screens show: funnel, search, listings, audience, charts", () => {
    expect(toolsFor("marketing", ALL)).toEqual([
      "get_market",
      "get_chart",
      "get_conversion_funnel",
      "get_keywords",
      "get_audience",
      "get_growth",
      "get_listing_changes",
      "get_instagram",
      "get_metric_notes",
    ]);
  });

  it("gives product installs, the funnel its Downloads page shows, reviews and listings", () => {
    expect(toolsFor("product", ALL)).toEqual([
      "get_downloads",
      "get_conversion_funnel",
      "get_reviews",
      "get_audience",
      "get_growth",
      "get_listing_changes",
      "get_instagram",
      "get_metric_notes",
    ]);
  });

  it("gives IT the collectors, the analyst report and the notes its Analyst page shows", () => {
    expect(toolsFor("it", ALL)).toEqual(["get_latest_report", "get_metric_notes", "get_collector_health"]);
  });

  it.each(["marketing", "product", "it"] as const)(
    "never hands %s the company's takings",
    (role) => {
      expect(toolsFor(role, ALL)).not.toContain("get_revenue");
    },
  );

  it("never grants a tool the catalogue does not have", () => {
    expect(toolsFor("marketing", ["get_keywords", "get_revenue"])).toEqual(["get_keywords"]);
  });
});

describe("Jarvis's own tools", () => {
  const EVERY = jarvisToolNames();

  it("give marketing the rank history its Rankings page shows", () => {
    expect(toolsFor("marketing", EVERY)).toContain("get_rank_history");
    expect(toolsFor("marketing", EVERY)).not.toContain("get_installs_today");
  });

  it("give product its ratings, today's installs and how each release landed", () => {
    expect(toolsFor("product", EVERY)).toEqual(
      expect.arrayContaining(["get_rating_history", "get_installs_today", "get_releases"]),
    );
  });

  it("keep iOS proceeds with the CEO", () => {
    expect(toolsFor("ceo", EVERY)).toContain("get_ios_proceeds");
    for (const role of ["marketing", "product", "it"] as const) {
      expect(toolsFor(role, EVERY)).not.toContain("get_ios_proceeds");
    }
  });

  it("give marketing the comment bot its Comments page shows, and no one else below the CEO", () => {
    expect(toolsFor("marketing", EVERY)).toContain("get_comment_activity");
    expect(toolsFor("ceo", EVERY)).toContain("get_comment_activity");
    expect(toolsFor("product", EVERY)).not.toContain("get_comment_activity");
    expect(toolsFor("it", EVERY)).not.toContain("get_comment_activity");
  });

  it("give IT the analyst's run history, so it can tell when the report stopped", () => {
    expect(toolsFor("it", EVERY)).toEqual([
      "get_latest_report",
      "get_metric_notes",
      "get_collector_health",
      "get_analyst_runs",
    ]);
    expect(toolsFor("marketing", EVERY)).not.toContain("get_analyst_runs");
    expect(toolsFor("product", EVERY)).not.toContain("get_analyst_runs");
  });
});

describe("roleFromHeader", () => {
  it.each([
    ["ceo", "ceo"],
    ["marketing", "marketing"],
    [" Product ", "product"],
  ] as const)("reads %j as %s", (header, role) => {
    expect(roleFromHeader(header)).toBe(role);
  });

  it.each([null, "", "admin", "ceo,marketing"])("refuses %j", (header) => {
    expect(roleFromHeader(header)).toBeNull();
  });
});

describe("posting to the team chat", () => {
  it("is the CEO's alone unless configured otherwise", () => {
    const roles = postingRolesFrom(undefined);
    expect(roles).toEqual(["ceo"]);
    expect(mayPost("ceo", roles)).toBe(true);
    expect(mayPost("marketing", roles)).toBe(false);
  });

  it("can be extended to named departments", () => {
    const roles = postingRolesFrom("ceo, marketing");
    expect(mayPost("marketing", roles)).toBe(true);
    expect(mayPost("product", roles)).toBe(false);
  });

  it("ignores names that are not departments rather than failing open", () => {
    expect(postingRolesFrom("admin, everyone, ceo")).toEqual(["ceo"]);
  });

  it("falls back to the CEO when the setting is empty", () => {
    expect(postingRolesFrom("  ")).toEqual(["ceo"]);
  });
});

describe("pagesFor", () => {
  it("lets the CEO show every page, the wall display included", () => {
    expect(pagesFor("ceo")).toContain("/business");
    expect(pagesFor("ceo")).toContain("/tv");
  });

  it("shows marketing only its own pages", () => {
    expect(pagesFor("marketing")).toEqual([
      "/",
      "/growth",
      "/rankings",
      "/keywords",
      "/market",
      "/audience",
      "/audience/telegram",
      "/audience/instagram",
      "/audience/youtube",
      "/comments",
    ]);
  });

  it.each(["marketing", "product", "it"] as const)("never shows %s the finances", (role) => {
    expect(pagesFor(role)).not.toContain("/business");
  });

  it("shows IT the analyst but not the audience", () => {
    expect(pagesFor("it")).toEqual(["/", "/analyst"]);
  });
});
