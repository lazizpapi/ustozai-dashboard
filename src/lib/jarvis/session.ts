import "server-only";

import { SESSION_COOKIE, type SessionScope } from "@/lib/gate";
import type { Role } from "@/lib/roles";

import type { JarvisResponse } from "./handle";

/**
 * A signed-in session for Jarvis's own browser, so it can show dashboard pages.
 *
 * Jarvis never holds a password. It trades its bearer token for a session the
 * dashboard signs exactly as the login page does, and its Python puts that
 * cookie into the browser directly: the model choosing tools never sees it.
 *
 * Three limits keep this narrow. The switch (JARVIS_SESSIONS_ENABLED) is off
 * by default, so the laptop's key signs nobody in until the owner says so. The
 * session lasts thirty minutes rather than a person's thirty days. And it is
 * signed under the CEO password like any other CEO session, so changing that
 * password ends Jarvis's sessions along with everyone else's. It is marked as
 * Jarvis's inside the signature, so the dashboard's chat refuses it: see
 * mayUseChat in gate.ts.
 *
 * Pure, with the signer injected, so the tests need neither the environment
 * nor a clock.
 */

export const JARVIS_SESSION_SECONDS = 30 * 60;

export type JarvisSessionBody = {
  ok: true;
  cookie: { name: string; value: string; path: string; expiresAt: number };
};

export type JarvisSessionDeps = {
  enabled: boolean;
  issue: (role: Role, now: number, maxAgeSeconds: number, scope: SessionScope) => string | null;
  now: number;
};

export function mintJarvisSession({ enabled, issue, now }: JarvisSessionDeps): JarvisResponse {
  if (!enabled) {
    return {
      status: 501,
      body: { ok: false, error: "Jarvis sessions are switched off (JARVIS_SESSIONS_ENABLED)." },
    };
  }

  const token = issue("ceo", now, JARVIS_SESSION_SECONDS, "jarvis");
  if (!token) {
    return {
      status: 503,
      body: { ok: false, error: "No CEO password is configured (DASHBOARD_PASSWORD), so there is nothing to sign with." },
    };
  }

  const body: JarvisSessionBody = {
    ok: true,
    cookie: {
      name: SESSION_COOKIE,
      value: token,
      path: "/",
      expiresAt: now + JARVIS_SESSION_SECONDS * 1000,
    },
  };
  return { status: 200, body };
}
