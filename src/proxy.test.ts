import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

/**
 * Which requests skip the session check.
 *
 * Machine callers under /api/jarvis carry their own bearer secret. The call
 * token a person asks for sits next to them in name only: it is for a signed
 * in person, so it must go through the same check as every page.
 */

function status(path: string): number {
  return proxy(new NextRequest(new URL(path, "https://dashboard.test"))).status;
}

describe("the proxy", () => {
  it("lets Jarvis's machine routes through to their own bearer check", () => {
    expect(status("/api/jarvis")).toBe(200);
    expect(status("/api/jarvis/get_revenue")).toBe(200);
    expect(status("/api/jarvis/session")).toBe(200);
  });

  it("does not wave through a route that only shares the prefix", () => {
    expect(status("/api/jarvis-token")).toBe(401);
  });

  it("sends a signed-out visitor to the login page", () => {
    expect(status("/jarvis")).toBe(307);
  });
});
