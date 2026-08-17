import { safeEqual } from "@/lib/cron-auth";
import { parseActiveUsersPayload } from "@/lib/active-users";
import { serviceClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Where the app backend pushes its active-user counts.
 *
 * Inbound rather than outbound because no store API can answer this: Apple
 * reports sessions only for analytics opt-ins and Google publishes nothing
 * equivalent, so only the app's own backend can count every user. That makes
 * this the one endpoint on the dashboard that accepts figures instead of
 * collecting them.
 *
 * Two consequences shape it. It needs its own secret, because the caller is a
 * server with no session cookie. And it validates hard, because a malformed
 * push does not throw anywhere: it just puts a wrong DAU on the wall display.
 * parseActiveUsersPayload does that work and is unit tested; this file is only
 * transport.
 */

function unauthorized(): Response {
  // Deliberately identical whether the secret is unset or wrong, so probing
  // cannot distinguish "not configured" from "wrong key".
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  // An unset secret closes the endpoint rather than opening it, the same way
  // an unset DASHBOARD_PASSWORD denies everyone.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, secret);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseActiveUsersPayload(body);
  if (!parsed.ok) {
    // The reason goes back in full. The caller is a developer's cron job, and
    // a bare 400 would leave them guessing which field or which day was wrong.
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const { error } = await serviceClient()
    .from("active_users_daily")
    .upsert(
      parsed.rows.map((row) => ({ ...row, received_at: new Date().toISOString() })),
      { onConflict: "date,platform" },
    );

  if (error) {
    return Response.json({ error: `could not store: ${error.message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    stored: parsed.rows.length,
    dates: parsed.rows.map((row) => row.date),
  });
}

/**
 * A health check the other developer can curl while wiring this up, so a
 * misconfigured secret is distinguishable from a misconfigured URL. It reports
 * nothing about the data and requires the same secret.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return Response.json({ ok: true, expects: "POST {date,dau,wau,mau} or an array of them" });
}
