import { describe, expect, it } from "vitest";

import { ROLES, canSee, navFor, viewFor, isRole } from "./roles";

/**
 * Which department sees which page.
 *
 * The reason this is a tested module rather than a few conditionals in the
 * layout: the failure mode is silent. A missing check does not throw, it just
 * shows Marketing the pipeline costs or shows everyone the CEO's view, and
 * nobody notices until the wrong person mentions a number in a meeting.
 */

describe("isRole", () => {
  it("accepts the four known roles", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
  });

  it("rejects anything else without throwing", () => {
    for (const value of ["admin", "", "CEO", undefined, null, "ceo "]) {
      expect(isRole(value)).toBe(false);
    }
  });
});

describe("canSee", () => {
  it("lets the CEO see every page", () => {
    for (const path of ["/", "/analyst", "/growth", "/market", "/downloads", "/reviews", "/keywords", "/rankings", "/tv"]) {
      expect(canSee("ceo", path)).toBe(true);
    }
  });

  it("gives every role its own dashboard", () => {
    for (const role of ROLES) expect(canSee(role, "/")).toBe(true);
  });

  it("keeps marketing out of product and pipeline pages", () => {
    expect(canSee("marketing", "/keywords")).toBe(true);
    expect(canSee("marketing", "/market")).toBe(true);
    expect(canSee("marketing", "/reviews")).toBe(false);
    expect(canSee("marketing", "/analyst")).toBe(false);
  });

  it("keeps product out of marketing and pipeline pages", () => {
    expect(canSee("product", "/reviews")).toBe(true);
    expect(canSee("product", "/downloads")).toBe(true);
    expect(canSee("product", "/keywords")).toBe(false);
    expect(canSee("product", "/analyst")).toBe(false);
  });

  it("keeps IT out of the commercial pages", () => {
    expect(canSee("it", "/analyst")).toBe(true);
    expect(canSee("it", "/market")).toBe(false);
    expect(canSee("it", "/reviews")).toBe(false);
  });

  it("covers nested paths under an allowed section", () => {
    // /market/praktika and /audience/telegram are drill-downs of pages the
    // role already has, so listing every child would be a maintenance trap.
    expect(canSee("marketing", "/market/praktika")).toBe(true);
    expect(canSee("marketing", "/audience/telegram")).toBe(true);
    expect(canSee("product", "/market/praktika")).toBe(false);
  });

  it("does not let a prefix match leak a different page", () => {
    // "/market" must not authorise "/marketing-costs". Segment boundaries
    // matter, or the whole map is decorative.
    expect(canSee("product", "/marketing-secrets")).toBe(false);
    expect(canSee("marketing", "/reviewsomething")).toBe(false);
  });

  it("denies an unknown page to everyone except the CEO", () => {
    // Fails closed: a page added later is invisible until it is granted.
    expect(canSee("marketing", "/payroll")).toBe(false);
    expect(canSee("ceo", "/payroll")).toBe(true);
  });
});

describe("viewFor", () => {
  it("maps each role to the dashboard it owns", () => {
    expect(viewFor("ceo")).toBe("ceo");
    expect(viewFor("marketing")).toBe("marketing");
    expect(viewFor("product")).toBe("product");
    expect(viewFor("it")).toBe("it");
  });
});

describe("navFor", () => {
  it("shows the CEO everything", () => {
    expect(navFor("ceo").length).toBeGreaterThan(5);
  });

  it("shows a department only pages it can open", () => {
    for (const role of ROLES) {
      for (const item of navFor(role)) {
        expect(canSee(role, item.href)).toBe(true);
      }
    }
  });

  it("never offers a department a link to another department's page", () => {
    const marketing = navFor("marketing").map((item) => item.href);
    expect(marketing).not.toContain("/reviews");
    expect(marketing).not.toContain("/analyst");
  });
});
