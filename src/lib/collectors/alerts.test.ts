/**
 * When a broken collector is worth mentioning, and when it is noise.
 *
 * The whole value of this alert is that people keep reading it. An alert that
 * repeats the same failure every hour gets muted within a day, and a muted
 * channel is worse than no channel because it still looks like coverage. So
 * the rule under test is narrow: report the transition, never the state.
 */

import { describe, expect, it } from "vitest";

import { detectStatusChanges, formatStatusAlert, type SourceStatus } from "./alerts";

const ok = (source: string): SourceStatus => ({ source, status: "ok" });
const failed = (source: string, error = "boom"): SourceStatus => ({
  source,
  status: "failed",
  error,
});
const skipped = (source: string): SourceStatus => ({ source, status: "skipped" });

describe("detectStatusChanges", () => {
  it("reports a source that has just broken", () => {
    const change = detectStatusChanges(
      [ok("social:instagram")],
      [failed("social:instagram", "token expired")],
    );

    expect(change.broke).toEqual([{ source: "social:instagram", error: "token expired" }]);
    expect(change.recovered).toEqual([]);
  });

  it("stays quiet about a source that was already broken", () => {
    // The one that matters. Instagram was failing every hour for four days;
    // this run must produce nothing at all.
    const change = detectStatusChanges(
      [failed("social:instagram", "token expired")],
      [failed("social:instagram", "token expired")],
    );

    expect(change.broke).toEqual([]);
    expect(change.recovered).toEqual([]);
  });

  it("reports a recovery", () => {
    const change = detectStatusChanges([failed("social:instagram")], [ok("social:instagram")]);

    expect(change.recovered).toEqual(["social:instagram"]);
    expect(change.broke).toEqual([]);
  });

  it("does not call a source skipped instead of failing a recovery", () => {
    // Somebody unset the handle. The collector is not fixed, it is switched
    // off, and saying "collecting again" would be a lie.
    const change = detectStatusChanges([failed("social:youtube")], [skipped("social:youtube")]);

    expect(change.recovered).toEqual([]);
    expect(change.broke).toEqual([]);
  });

  it("reports a never-seen source only when it arrives already failing", () => {
    expect(detectStatusChanges([], [failed("social:threads", "no such handle")]).broke).toEqual([
      { source: "social:threads", error: "no such handle" },
    ]);

    // A first successful run is not news.
    expect(detectStatusChanges([], [ok("social:threads")]).broke).toEqual([]);
  });

  it("leaves a source that did not run this time alone", () => {
    // Absent from `now` means the step never executed. That is not the same as
    // passing, and reporting it as recovered would be inventing a result.
    const change = detectStatusChanges([failed("play-details:uz")], [ok("itunes-lookup:uz")]);

    expect(change.recovered).toEqual([]);
    expect(change.broke).toEqual([]);
  });

  it("falls back to a plain word when the failure carried no message", () => {
    const change = detectStatusChanges([ok("x")], [{ source: "x", status: "failed", error: "  " }]);

    expect(change.broke).toEqual([{ source: "x", error: "failed" }]);
  });
});

describe("formatStatusAlert", () => {
  it("says nothing on a quiet hour", () => {
    expect(formatStatusAlert({ broke: [], recovered: [] })).toBeNull();
  });

  it("names the source and its error", () => {
    const message = formatStatusAlert({
      broke: [{ source: "social:instagram", error: "token expired" }],
      recovered: [],
    });

    expect(message).toContain("Collector stopped");
    expect(message).toContain("social:instagram: token expired");
  });

  it("escapes markup so an error message cannot break the send", () => {
    // Telegram is called with parse_mode HTML. An unescaped angle bracket in a
    // stack trace would be rejected as malformed and the alert would vanish.
    const message = formatStatusAlert({
      broke: [{ source: "x", error: "<script>alert(1)</script> & more" }],
      recovered: [],
    });

    expect(message).toContain("&lt;script&gt;");
    expect(message).toContain("&amp; more");
    expect(message).not.toContain("<script>");
  });

  it("caps a long list rather than sending an unreadable wall", () => {
    const broke = Array.from({ length: 9 }, (_, i) => ({ source: `s${i}`, error: "boom" }));

    const message = formatStatusAlert({ broke, recovered: [] })!;

    expect(message).toContain("and 3 more");
    expect(message).not.toContain("s6:");
  });

  it("reports both directions in one message", () => {
    const message = formatStatusAlert({
      broke: [{ source: "a", error: "boom" }],
      recovered: ["b"],
    })!;

    expect(message).toContain("Collector stopped");
    expect(message).toContain("Collecting again");
    expect(message).toContain("b");
  });
});
