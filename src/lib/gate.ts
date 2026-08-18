import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ROLES, isRole, type Role } from "./roles";

/**
 * Shared-password access gate, one password per department.
 *
 * There are no per-person accounts, so you cannot tell who looked at what, and
 * removing one person means changing their department's password. For an
 * internal dashboard read by a handful of colleagues that is a reasonable
 * price for something that always works.
 *
 * What the passwords buy is separation. Marketing, Product and IT each get
 * their own, and each unlocks only that department's dashboard and pages; the
 * CEO's password unlocks everything. Departments cannot read each other's
 * screens, which was the whole point of retiring the view switcher.
 *
 * The cookie never contains a password. It holds an expiry, the role, and an
 * HMAC over both, keyed by a hash of that role's password. Three consequences
 * worth knowing:
 *
 * A stolen cookie cannot be turned back into a password.
 *
 * The role is inside the signed payload, so editing a marketing cookie to say
 * "ceo" invalidates it rather than promoting the holder. That is the attack
 * this shape exists to stop.
 *
 * Each role is signed under its own password, so rotating one department's
 * password signs out that department and nobody else.
 */

export const SESSION_COOKIE = "ustozai_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Domain separation, so this HMAC key cannot collide with any other use. */
const KEY_CONTEXT = "ustozai-dashboard:session:v1";

/** Where each role's password lives. The CEO keeps the original variable so
 *  that adding departments does not sign the existing team out. */
const PASSWORD_VARS: Record<Role, string> = {
  ceo: "DASHBOARD_PASSWORD",
  marketing: "DASHBOARD_PASSWORD_MARKETING",
  product: "DASHBOARD_PASSWORD_PRODUCT",
  it: "DASHBOARD_PASSWORD_IT",
};

function signingKey(password: string): Buffer {
  return createHash("sha256").update(`${KEY_CONTEXT}:${password}`).digest();
}

function sign(payload: string, password: string): string {
  return createHmac("sha256", signingKey(password)).update(payload).digest("base64url");
}

/** Length-safe constant-time compare. timingSafeEqual throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The password configured for a role, if it is long enough to be worth having.
 *
 * An unset or short password disables that role rather than weakening it: a
 * deploy that forgets a department's variable leaves that department locked
 * out, which is the safe direction to fail.
 */
export function passwordFor(role: Role): string | null {
  const password = process.env[PASSWORD_VARS[role]];
  return password && password.length >= 8 ? password : null;
}

/** The CEO password, kept under its original name for existing callers. */
export function configuredPassword(): string | null {
  return passwordFor("ceo");
}

/**
 * Which department a password belongs to, or null.
 *
 * Every configured role is checked rather than returning on the first match,
 * so the work done does not depend on which password was supplied.
 */
export function roleForPassword(input: string): Role | null {
  let matched: Role | null = null;

  for (const role of ROLES) {
    const actual = passwordFor(role);
    if (actual && safeEqual(input, actual)) matched = role;
  }

  return matched;
}

/** Kept for the CEO-only callers that predate departments. */
export function passwordMatches(input: string): boolean {
  const actual = configuredPassword();
  if (!actual) return false;
  return safeEqual(input, actual);
}

export function issueSessionToken(
  role: Role = "ceo",
  now: number = Date.now(),
): string | null {
  const password = passwordFor(role);
  if (!password) return null;

  const expiresAt = String(now + SESSION_MAX_AGE_SECONDS * 1000);
  // The role is part of the signed payload, not a separate field, so it
  // cannot be edited without breaking the signature.
  const payload = `${expiresAt}.${role}`;
  return `${payload}.${sign(payload, password)}`;
}

/** Splits a token without trusting any of it. */
function parse(token: string): { payload: string; role: Role; expiresAt: number; signature: string } | null {
  const parts = token.split(".");
  // Exactly three parts. The old two-part shape carried no role and is
  // rejected outright, which costs everyone one sign-in and beats guessing
  // that a legacy cookie meant full access.
  if (parts.length !== 3) return null;

  const [expiry, role, signature] = parts;
  if (!expiry || !role || !signature) return null;
  if (!isRole(role)) return null;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt)) return null;

  return { payload: `${expiry}.${role}`, role, expiresAt, signature };
}

export function isValidSessionToken(
  token: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!token) return false;

  const parsed = parse(token);
  if (!parsed) return false;

  const password = passwordFor(parsed.role);
  if (!password) return false;

  // Verify the signature before trusting the expiry at all.
  if (!safeEqual(parsed.signature, sign(parsed.payload, password))) return false;

  return parsed.expiresAt > now;
}

/** The role a valid token carries, or null if it is not valid. */
export function roleFromToken(
  token: string | undefined | null,
  now: number = Date.now(),
): Role | null {
  if (!isValidSessionToken(token, now)) return null;
  return parse(token as string)?.role ?? null;
}
