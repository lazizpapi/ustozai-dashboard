import { afterEach, describe, expect, it } from "vitest";

import { isAuthorizedBearer, isAuthorizedCron, safeEqual } from "./cron-auth";

/**
 * The bearer check every machine caller goes through.
 *
 * Three callers now share it — cron, the ingest routes and Jarvis — and the
 * thing worth pinning is not that a correct token passes but that each way of
 * getting it wrong fails closed. An unset secret in particular: a deploy that
 * forgets the variable must lock the door, not remove it.
 */

function bearer(token: string | null): Request {
  return new Request("https://example.test/api/whatever", {
    headers: token === null ? {} : { authorization: token },
  });
}

describe("safeEqual", () => {
  it("matches identical strings and rejects different ones", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("rejects a prefix rather than reading past the shorter string", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });
});

describe("isAuthorizedBearer", () => {
  it("accepts the matching token", () => {
    expect(isAuthorizedBearer(bearer("Bearer s3cret"), "s3cret")).toBe(true);
  });

  it("refuses everyone when the secret is unset", () => {
    // The failure mode this exists to prevent: a missing environment variable
    // turning the endpoint public instead of closing it.
    expect(isAuthorizedBearer(bearer("Bearer s3cret"), undefined)).toBe(false);
    expect(isAuthorizedBearer(bearer("Bearer "), "")).toBe(false);
  });

  it("refuses a missing or malformed header", () => {
    expect(isAuthorizedBearer(bearer(null), "s3cret")).toBe(false);
    expect(isAuthorizedBearer(bearer("s3cret"), "s3cret")).toBe(false);
    expect(isAuthorizedBearer(bearer("Basic s3cret"), "s3cret")).toBe(false);
  });

  it("refuses a wrong token, including one that only starts right", () => {
    expect(isAuthorizedBearer(bearer("Bearer wrong"), "s3cret")).toBe(false);
    expect(isAuthorizedBearer(bearer("Bearer s3c"), "s3cret")).toBe(false);
  });
});

describe("isAuthorizedCron", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("reads its secret from CRON_SECRET", () => {
    process.env.CRON_SECRET = "cron-token";
    expect(isAuthorizedCron(bearer("Bearer cron-token"))).toBe(true);
    expect(isAuthorizedCron(bearer("Bearer jarvis-token"))).toBe(false);
  });

  it("stays closed when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(bearer("Bearer anything"))).toBe(false);
  });
});
