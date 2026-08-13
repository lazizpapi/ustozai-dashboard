import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isValidSessionToken } from "@/lib/gate";

/**
 * Next.js 16 renamed middleware.ts to proxy.ts, and it runs on the Node.js
 * runtime by default, which is what lets the gate use node:crypto.
 *
 * This is the fast redirect, not the authoritative check. src/app/load.ts
 * re-verifies on the server before any page renders a figure. Both exist on
 * purpose: Next's own guidance is that a proxy check is optimistic.
 */

const PUBLIC_PREFIXES = ["/login", "/auth"];

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  /*
   * Machine callers authenticate with their own secret and have no cookie, so
   * they must never be redirected to a login page. Cron sends a bearer token;
   * the Telegram webhook sends a secret header.
   *
   * Missing the webhook here is a silent failure rather than a loud one:
   * Telegram would receive a 307 to /login, read any non-2xx as delivery
   * failure, and retry the same update for hours while the member count never
   * moved and nothing anywhere recorded an error.
   */
  if (path.startsWith("/api/cron") || path.startsWith("/api/webhook")) {
    return NextResponse.next();
  }
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
