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

/**
 * The bearer check itself, against a secret the caller names.
 *
 * Pulled out because there are now three machine callers with three separate
 * secrets — cron, the ingest routes and Jarvis — and they were converging on
 * three copies of these five lines. Separate secrets are the point: the key
 * Jarvis holds reads, and can sign its browser in or post to the team chat
 * only while those switches are on; the key the app backend holds only writes
 * counts; and neither should be able to do the other's job.
 *
 * An unset secret returns false rather than skipping the check, so a deploy
 * that forgets the variable closes the endpoint instead of opening it.
 */
export function isAuthorizedBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, secret);
}

export function isAuthorizedCron(request: Request): boolean {
  return isAuthorizedBearer(request, process.env.CRON_SECRET);
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
