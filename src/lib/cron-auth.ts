import "server-only";

/**
 * Guards the cron routes.
 *
 * These endpoints write to the database and hammer third-party APIs, so they
 * are not public. Vercel Cron sends the project's CRON_SECRET as a bearer
 * token; an external scheduler hitting the same route must send the same
 * header. Comparison is length-safe and constant-time-ish to avoid leaking the
 * secret through response timing.
 */

/**
 * Exported because the Telegram webhook compares a secret header rather than a
 * bearer token, and a second hand-rolled comparison is how one of them ends up
 * being the naive one.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, secret);
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
