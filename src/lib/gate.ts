import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared-password access gate.
 *
 * One password for the team, no email in the path. The tradeoff is accepted
 * deliberately: there are no per-person accounts, so you cannot tell who looked
 * at what, and removing one person's access means changing the password for
 * everyone. For an internal metrics dashboard read by a handful of colleagues
 * that is a reasonable price for something that always works.
 *
 * The cookie never contains the password. It holds an expiry timestamp and an
 * HMAC over it, keyed by a hash of the password. Two consequences worth
 * knowing: a stolen cookie cannot be turned back into the password, and
 * changing DASHBOARD_PASSWORD invalidates every existing session at once, which
 * is how you sign everybody out.
 */

export const SESSION_COOKIE = "ustozai_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Domain separation, so this HMAC key cannot collide with any other use. */
const KEY_CONTEXT = "ustozai-dashboard:session:v1";

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

export function configuredPassword(): string | null {
  const password = process.env.DASHBOARD_PASSWORD;
  // An unset password denies everyone rather than admitting everyone. A deploy
  // that forgets this variable should be closed, not wide open.
  return password && password.length >= 8 ? password : null;
}

export function passwordMatches(input: string): boolean {
  const actual = configuredPassword();
  if (!actual) return false;
  return safeEqual(input, actual);
}

export function issueSessionToken(now: number = Date.now()): string | null {
  const password = configuredPassword();
  if (!password) return null;

  const expiresAt = String(now + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAt}.${sign(expiresAt, password)}`;
}

export function isValidSessionToken(
  token: string | undefined | null,
  now: number = Date.now(),
): boolean {
  const password = configuredPassword();
  if (!password || !token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Verify the signature before trusting the payload at all.
  if (!safeEqual(signature, sign(payload, password))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}
