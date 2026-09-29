import { canSee, isRole, type Role } from "@/lib/roles";

/**
 * What Jarvis may do for whoever is talking to it.
 *
 * Jarvis answers anyone signed in to the dashboard, so the same line the
 * department passwords draw around screens is drawn here around tools. The
 * rule for each department is "what your own screens already show", read off
 * the views and pages in roles.ts:
 *
 *   marketing  its dashboard (funnel, keywords, listings, audience), Growth,
 *              Rankings, Market, Keywords and the audience pages
 *   product    its dashboard (installs, reviews, listings), Downloads,
 *              Reviews, Growth and the audience pages
 *   it         its dashboard (collectors, analyst runs) and Analyst
 *
 * The CEO gets every tool, including any added later. A department gets a new
 * tool only when it is named below, so the list fails closed the way canSee
 * does. The takings (get_revenue) are named nowhere, for the reason canSee
 * gives for "/business".
 *
 * Metric notes are granted because both departments see note markers on their
 * pages; the revenue notes among them are removed by visibleKeys when the tool
 * runs, not here.
 */

const DEPARTMENT_TOOLS: Record<Exclude<Role, "ceo">, readonly string[]> = {
  marketing: [
    "get_conversion_funnel",
    "get_keywords",
    "get_listing_changes",
    "get_audience",
    "get_instagram",
    "get_growth",
    "get_chart",
    "get_market",
    "get_metric_notes",
  ],
  product: [
    "get_downloads",
    "get_reviews",
    "get_listing_changes",
    "get_growth",
    "get_audience",
    "get_instagram",
    "get_metric_notes",
  ],
  it: ["get_collector_health", "get_latest_report"],
};

/** The tools a role may use, in the catalogue's own order. */
export function toolsFor(role: Role, catalogue: readonly string[]): string[] {
  if (role === "ceo") return [...catalogue];
  const granted = DEPARTMENT_TOOLS[role];
  return catalogue.filter((name) => granted.includes(name));
}

/**
 * The caller's department, as Jarvis sends it in X-Jarvis-Role.
 *
 * Trusted because only the agent holds JARVIS_SECRET and the agent reads the
 * role from a LiveKit token the dashboard signed. Anything that is not exactly
 * one department is refused, so a malformed header never becomes the CEO.
 */
export function roleFromHeader(value: string | null): Role | null {
  const role = value?.trim().toLowerCase();
  return isRole(role) ? role : null;
}

/**
 * Who may post to the team's Telegram chat through Jarvis: JARVIS_POSTING_ROLES,
 * a comma-separated list, the CEO alone by default. Unknown names are dropped
 * rather than trusted, and an empty setting means the default, never nobody
 * and never everybody.
 */
export function postingRolesFrom(value: string | undefined): Role[] {
  const roles = (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(isRole);
  return roles.length > 0 ? [...new Set(roles)] : ["ceo"];
}

export function mayPost(role: Role, postingRoles: readonly Role[]): boolean {
  return postingRoles.includes(role);
}

/**
 * Every page Jarvis knows how to put on screen, in the order its page tool
 * lists them. Mirrors PAGES in the agent's dashboard_pages.py.
 */
export const JARVIS_PAGES = [
  "/",
  "/business",
  "/downloads",
  "/growth",
  "/rankings",
  "/reviews",
  "/keywords",
  "/market",
  "/audience",
  "/audience/telegram",
  "/audience/instagram",
  "/audience/youtube",
  "/analyst",
  "/comments",
  "/tv",
] as const;

/** The pages Jarvis may show this role: exactly the ones canSee lets it open. */
export function pagesFor(role: Role): string[] {
  return JARVIS_PAGES.filter((path) => canSee(role, path));
}
