import { afterEach, describe, expect, it } from "vitest";

import {
  isValidSessionToken,
  issueSessionToken,
  passwordMatches,
  roleForPassword,
  roleFromToken,
  SESSION_MAX_AGE_SECONDS,
} from "./gate";

const ROLE_VARS = [
  "DASHBOARD_PASSWORD",
  "DASHBOARD_PASSWORD_MARKETING",
  "DASHBOARD_PASSWORD_PRODUCT",
  "DASHBOARD_PASSWORD_IT",
] as const;

const original = Object.fromEntries(ROLE_VARS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of ROLE_VARS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

const withPassword = (value: string | undefined) => {
  if (value === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = value;
};

const withRolePasswords = (values: Partial<Record<(typeof ROLE_VARS)[number], string>>) => {
  for (const key of ROLE_VARS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
};

describe("passwordMatches", () => {
  it("accepts the configured password and rejects anything else", () => {
    withPassword("correct-horse-battery");

    expect(passwordMatches("correct-horse-battery")).toBe(true);
    expect(passwordMatches("Correct-horse-battery")).toBe(false);
    expect(passwordMatches("correct-horse-batter")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });

  it("denies everyone when no password is set", () => {
    // Fails closed. An unset variable must never mean "let everybody in".
    withPassword(undefined);
    expect(passwordMatches("anything")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });

  it("refuses a password too short to be worth having", () => {
    withPassword("short");
    expect(passwordMatches("short")).toBe(false);
  });
});

describe("session tokens", () => {
  it("issues a token that validates", () => {
    withPassword("correct-horse-battery");
    const token = issueSessionToken();

    expect(token).not.toBeNull();
    expect(isValidSessionToken(token)).toBe(true);
  });

  it("never contains the password", () => {
    withPassword("correct-horse-battery");
    expect(issueSessionToken()).not.toContain("correct-horse-battery");
  });

  it("rejects a token signed under a different password", () => {
    // This is what makes changing the password sign everyone out.
    withPassword("first-password-value");
    const token = issueSessionToken();

    withPassword("second-password-value");
    expect(isValidSessionToken(token)).toBe(false);
  });

  it("rejects an expired token", () => {
    withPassword("correct-horse-battery");
    const issuedAt = Date.parse("2026-01-01T00:00:00Z");
    const token = issueSessionToken("ceo", issuedAt);

    const justBefore = issuedAt + SESSION_MAX_AGE_SECONDS * 1000 - 1000;
    const justAfter = issuedAt + SESSION_MAX_AGE_SECONDS * 1000 + 1000;

    expect(isValidSessionToken(token, justBefore)).toBe(true);
    expect(isValidSessionToken(token, justAfter)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    // Pushing the expiry out by hand must invalidate the signature.
    withPassword("correct-horse-battery");
    const token = issueSessionToken()!;
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${Date.now() + 10_000_000}.${signature}`;

    expect(isValidSessionToken(forged)).toBe(false);
  });

  it("rejects malformed and empty tokens", () => {
    withPassword("correct-horse-battery");

    for (const bad of ["", ".", "nodot", "abc.def", `${Date.now() + 1000}.`]) {
      expect(isValidSessionToken(bad)).toBe(false);
    }
    expect(isValidSessionToken(undefined)).toBe(false);
    expect(isValidSessionToken(null)).toBe(false);
  });

  it("issues nothing and validates nothing without a configured password", () => {
    withPassword("correct-horse-battery");
    const token = issueSessionToken();

    withPassword(undefined);
    expect(issueSessionToken()).toBeNull();
    expect(isValidSessionToken(token)).toBe(false);
  });
});

describe("department passwords", () => {
  const passwords = {
    DASHBOARD_PASSWORD: "chief-executive-secret",
    DASHBOARD_PASSWORD_MARKETING: "marketing-team-secret",
    DASHBOARD_PASSWORD_PRODUCT: "product-team-secret",
    DASHBOARD_PASSWORD_IT: "pipeline-team-secret",
  } as const;

  it("resolves each password to its own role", () => {
    withRolePasswords(passwords);

    expect(roleForPassword("chief-executive-secret")).toBe("ceo");
    expect(roleForPassword("marketing-team-secret")).toBe("marketing");
    expect(roleForPassword("product-team-secret")).toBe("product");
    expect(roleForPassword("pipeline-team-secret")).toBe("it");
  });

  it("rejects a password nobody uses", () => {
    withRolePasswords(passwords);
    expect(roleForPassword("not-any-of-them")).toBeNull();
    expect(roleForPassword("")).toBeNull();
  });

  it("leaves a department disabled when its password is unset", () => {
    // Fails closed. A department with no password configured cannot sign in
    // at all, rather than falling back to some other role's access.
    withRolePasswords({ DASHBOARD_PASSWORD: "chief-executive-secret" });

    expect(roleForPassword("chief-executive-secret")).toBe("ceo");
    expect(roleForPassword("marketing-team-secret")).toBeNull();
  });

  it("ignores a department password too short to be worth having", () => {
    withRolePasswords({
      DASHBOARD_PASSWORD: "chief-executive-secret",
      DASHBOARD_PASSWORD_MARKETING: "short",
    });

    expect(roleForPassword("short")).toBeNull();
  });

  it("round-trips a role through the token", () => {
    withRolePasswords(passwords);

    for (const role of ["ceo", "marketing", "product", "it"] as const) {
      const token = issueSessionToken(role)!;
      expect(isValidSessionToken(token)).toBe(true);
      expect(roleFromToken(token)).toBe(role);
    }
  });

  it("refuses a token whose role was swapped after signing", () => {
    // The attack this exists to stop: take a marketing cookie, edit the role
    // segment to ceo, and read the company numbers. The signature covers the
    // role, so the edit invalidates it.
    withRolePasswords(passwords);

    const token = issueSessionToken("marketing")!;
    const [expiry, , signature] = token.split(".");
    const forged = [expiry, "ceo", signature].join(".");

    expect(isValidSessionToken(forged)).toBe(false);
    expect(roleFromToken(forged)).toBeNull();
  });

  it("signs each role under its own password, so one change logs out one team", () => {
    withRolePasswords(passwords);
    const marketing = issueSessionToken("marketing")!;
    const ceo = issueSessionToken("ceo")!;

    withRolePasswords({ ...passwords, DASHBOARD_PASSWORD_MARKETING: "marketing-rotated-x" });

    expect(isValidSessionToken(marketing)).toBe(false);
    expect(isValidSessionToken(ceo)).toBe(true);
  });

  it("rejects a token naming a role that does not exist", () => {
    withRolePasswords(passwords);
    const token = issueSessionToken("ceo")!;
    const [expiry, , signature] = token.split(".");

    expect(isValidSessionToken([expiry, "admin", signature].join("."))).toBe(false);
  });

  it("rejects the old two-part token shape", () => {
    // Sessions issued before roles existed carry no role and cannot be
    // assigned one safely, so everybody signs in once more. Better than
    // guessing that an old cookie meant full access.
    withRolePasswords(passwords);

    const expiry = String(Date.now() + 60_000);
    expect(isValidSessionToken(`${expiry}.somesignature`)).toBe(false);
  });

  it("reads no role from a malformed token", () => {
    withRolePasswords(passwords);
    for (const bad of ["", "a.b", "..", "x.y.z", undefined, null]) {
      expect(roleFromToken(bad as string | undefined)).toBeNull();
    }
  });
});
