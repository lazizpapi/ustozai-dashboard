/**
 * Which department sees which page.
 *
 * The dashboard used to offer four views to everybody through a switcher.
 * That was fine while one password meant one audience, but departments should
 * not read each other's screens, and the CEO's view least of all. The switcher
 * is gone: your password decides which dashboard you get.
 *
 * This lives in its own tested module because the failure mode is silent. A
 * missing check does not throw. It shows Marketing the pipeline internals, or
 * shows a department the company-wide numbers, and nobody finds out until the
 * wrong person quotes a figure in a meeting.
 *
 * Two rules make it safe to extend:
 *
 * It fails closed. A page that nobody has granted is visible to the CEO only,
 * so adding a route cannot accidentally expose it to a department.
 *
 * Matching respects segment boundaries. "/market" grants "/market/praktika"
 * but never "/marketing-costs", which is exactly the kind of prefix accident
 * that turns an access list into decoration.
 */

export const ROLES = ["ceo", "marketing", "product", "it"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The dashboard each role lands on. One view each, no switching. */
const VIEWS: Record<Role, "ceo" | "marketing" | "product" | "it"> = {
  ceo: "ceo",
  marketing: "marketing",
  product: "product",
  it: "it",
};

export function viewFor(role: Role): "ceo" | "marketing" | "product" | "it" {
  return VIEWS[role];
}

interface NavItem {
  href: string;
  label: string;
}

/** Every page a department may open, beyond its own dashboard at "/". */
const SECTIONS: Record<Exclude<Role, "ceo">, NavItem[]> = {
  marketing: [
    { href: "/growth", label: "Growth" },
    { href: "/rankings", label: "Rankings" },
    { href: "/market", label: "Market" },
    { href: "/keywords", label: "Keywords" },
  ],
  product: [
    { href: "/downloads", label: "Downloads" },
    { href: "/reviews", label: "Reviews" },
    { href: "/growth", label: "Growth" },
  ],
  it: [{ href: "/analyst", label: "Analyst" }],
};

/** The CEO's nav, which is also the full list of pages that exist. */
const ALL: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/analyst", label: "Analyst" },
  { href: "/growth", label: "Growth" },
  { href: "/rankings", label: "Rankings" },
  { href: "/market", label: "Market" },
  { href: "/downloads", label: "Downloads" },
  { href: "/keywords", label: "Keywords" },
  { href: "/reviews", label: "Reviews" },
];

/**
 * Audience drill-downs follow whoever can see the figure that links to them.
 * Both the company and marketing dashboards show follower counts.
 */
const AUDIENCE_ROLES: Role[] = ["ceo", "marketing", "product"];

/**
 * Does `path` sit inside `section`?
 *
 * Exact match, or a child separated by a slash. Never a plain string prefix,
 * which would let "/market" authorise "/marketing-costs".
 */
function within(path: string, section: string): boolean {
  if (section === "/") return path === "/";
  return path === section || path.startsWith(`${section}/`);
}

export function canSee(role: Role, path: string): boolean {
  // The CEO's view is the whole company, so it carries no page restrictions.
  if (role === "ceo") return true;

  if (path === "/") return true;
  if (within(path, "/audience")) return AUDIENCE_ROLES.includes(role);
  if (within(path, "/tv")) return false;

  return SECTIONS[role].some((item) => within(path, item.href));
}

export function navFor(role: Role): NavItem[] {
  if (role === "ceo") return ALL;
  return [{ href: "/", label: "Overview" }, ...SECTIONS[role]];
}
