import { afterEach, describe, expect, it } from "vitest";

import {
  isValidSessionToken,
  issueSessionToken,
  passwordMatches,
  SESSION_MAX_AGE_SECONDS,
} from "./gate";

const original = process.env.DASHBOARD_PASSWORD;
afterEach(() => {
  process.env.DASHBOARD_PASSWORD = original;
});

const withPassword = (value: string | undefined) => {
  if (value === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = value;
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
    const token = issueSessionToken(issuedAt);

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
