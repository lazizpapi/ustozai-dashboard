import { afterEach, describe, expect, it } from "vitest";

import { isValidSessionToken, issueSessionToken, roleFromToken, SESSION_COOKIE } from "@/lib/gate";

import { JARVIS_SESSION_SECONDS, mintJarvisSession, type JarvisSessionBody } from "./session";

/**
 * The session Jarvis's own browser uses to show dashboard pages.
 *
 * It is a CEO session, because Jarvis reads everything, and it is short:
 * thirty minutes, re-minted by Jarvis as it runs out. The switch is off by
 * default so that the key on the laptop cannot sign anybody in until the
 * owner decides it may.
 */

const NOW = Date.parse("2026-09-28T10:00:00Z");
const originalPassword = process.env.DASHBOARD_PASSWORD;
afterEach(() => {
  if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = originalPassword;
});

describe("a session for Jarvis's browser", () => {
  it("is refused while the switch is off", () => {
    const result = mintJarvisSession({ enabled: false, issue: () => "token", now: NOW });
    expect(result.status).toBe(501);
    expect(result.body).toMatchObject({ ok: false });
  });

  it("is a thirty-minute CEO session when the switch is on", () => {
    const calls: unknown[][] = [];
    const result = mintJarvisSession({
      enabled: true,
      issue: (...args) => {
        calls.push(args);
        return "signed-token";
      },
      now: NOW,
    });

    expect(result.status).toBe(200);
    expect(calls).toEqual([["ceo", NOW, JARVIS_SESSION_SECONDS]]);
    expect(result.body).toEqual({
      ok: true,
      cookie: {
        name: SESSION_COOKIE,
        value: "signed-token",
        path: "/",
        expiresAt: NOW + JARVIS_SESSION_SECONDS * 1000,
      },
    });
  });

  it("lasts thirty minutes, not the thirty days a person gets", () => {
    expect(JARVIS_SESSION_SECONDS).toBe(1800);
  });

  it("says so when there is no CEO password to sign it with", () => {
    const result = mintJarvisSession({ enabled: true, issue: () => null, now: NOW });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).toContain("DASHBOARD_PASSWORD");
  });

  it("signs a token the dashboard itself accepts as the CEO's, until it expires", () => {
    process.env.DASHBOARD_PASSWORD = "correct-horse-battery";
    const result = mintJarvisSession({ enabled: true, issue: issueSessionToken, now: NOW });
    const { value } = (result.body as JarvisSessionBody).cookie;

    expect(roleFromToken(value, NOW + 60_000)).toBe("ceo");
    expect(isValidSessionToken(value, NOW + JARVIS_SESSION_SECONDS * 1000 + 1000)).toBe(false);
  });
});
