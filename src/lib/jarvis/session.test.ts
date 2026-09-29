import { afterEach, describe, expect, it } from "vitest";

import {
  isValidSessionToken,
  issueSessionToken,
  mayUseChat,
  roleFromToken,
  scopeFromToken,
  SESSION_COOKIE,
} from "@/lib/gate";

import { JARVIS_SESSION_SECONDS, mintJarvisSession, type JarvisSessionBody } from "./session";

/**
 * The session Jarvis's own browser uses to show dashboard pages.
 *
 * It is signed for whoever is talking to Jarvis, so a department's call can
 * open only that department's pages, and it is short: thirty minutes,
 * re-minted by Jarvis as it runs out. The switch is off by
 * default so that the key on the laptop cannot sign anybody in until the
 * owner decides it may.
 */

const NOW = Date.parse("2026-09-28T10:00:00Z");
const originalPassword = process.env.DASHBOARD_PASSWORD;
const originalMarketing = process.env.DASHBOARD_PASSWORD_MARKETING;
afterEach(() => {
  if (originalPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = originalPassword;
  if (originalMarketing === undefined) delete process.env.DASHBOARD_PASSWORD_MARKETING;
  else process.env.DASHBOARD_PASSWORD_MARKETING = originalMarketing;
});

describe("a session for Jarvis's browser", () => {
  it("is refused while the switch is off", () => {
    const result = mintJarvisSession({ enabled: false, issue: () => "token", now: NOW, role: "ceo" });
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
      role: "ceo",
    });

    expect(result.status).toBe(200);
    expect(calls).toEqual([["ceo", NOW, JARVIS_SESSION_SECONDS, "jarvis"]]);
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
    const result = mintJarvisSession({ enabled: true, issue: () => null, now: NOW, role: "ceo" });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).toContain("DASHBOARD_PASSWORD");
  });

  it("signs a token the dashboard itself accepts as the CEO's, until it expires", () => {
    process.env.DASHBOARD_PASSWORD = "correct-horse-battery";
    const result = mintJarvisSession({ enabled: true, issue: issueSessionToken, now: NOW, role: "ceo" });
    const { value } = (result.body as JarvisSessionBody).cookie;

    expect(roleFromToken(value, NOW + 60_000)).toBe("ceo");
    expect(scopeFromToken(value, NOW + 60_000)).toBe("jarvis");
    expect(mayUseChat(roleFromToken(value, NOW + 60_000), scopeFromToken(value, NOW + 60_000))).toBe(false);
    expect(isValidSessionToken(value, NOW + JARVIS_SESSION_SECONDS * 1000 + 1000)).toBe(false);
  });

  it("is signed for the department on the call, never promoted to the CEO", () => {
    process.env.DASHBOARD_PASSWORD_MARKETING = "marketing-password-long";
    const result = mintJarvisSession({
      enabled: true,
      issue: issueSessionToken,
      now: NOW,
      role: "marketing",
    });
    const { value } = (result.body as JarvisSessionBody).cookie;

    expect(roleFromToken(value, NOW + 60_000)).toBe("marketing");
    expect(scopeFromToken(value, NOW + 60_000)).toBe("jarvis");
  });

  it("names the missing password of the department on the call", () => {
    const result = mintJarvisSession({ enabled: true, issue: () => null, now: NOW, role: "product" });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).toContain("DASHBOARD_PASSWORD_PRODUCT");
  });
});
