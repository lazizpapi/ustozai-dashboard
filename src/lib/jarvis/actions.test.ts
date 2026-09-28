import { describe, expect, it } from "vitest";

import { TELEGRAM_LIMIT } from "@/lib/analyst/format";
import type { AnalystReport } from "@/lib/analyst/schema";
import type { AnalystRow } from "@/lib/db/queries";

import { JARVIS_LABEL, MAX_MESSAGE_CHARS, runJarvisAction, type ActionDeps } from "./actions";

/**
 * What Jarvis may post to the team's Telegram chat.
 *
 * By the time a request arrives here, Jarvis has read the message back and
 * heard a yes; that check lives on the Jarvis side, next to the microphone.
 * This file makes sure what reaches the chat is what was meant: the report as
 * the analyst formats it, or a short message, escaped and labelled so nobody
 * mistakes it for a person.
 */

const report = {
  health: "green",
  headline: "Downloads up 12% week on week",
  changes: [],
  recommendations: [],
} as unknown as AnalystReport;

const row: AnalystRow = {
  id: "r1",
  createdAt: "2026-09-28T06:00:00Z",
  status: "ok",
  health: "green",
  headline: "Downloads up 12% week on week",
  report,
  model: "test",
  error: null,
};

function deps(overrides: Partial<ActionDeps> = {}): ActionDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    latestReport: async () => row,
    send: async (text) => (sent.push(text), { sent: true }),
    reportUrl: "https://dash.example/analyst",
    ...overrides,
  };
}

describe("send_report", () => {
  it("posts the latest report as the analyst formats it, and says how old it is", async () => {
    const d = deps();
    const result = await runJarvisAction("send_report", {}, d);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, sent: true, reportCreatedAt: row.createdAt });
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toContain("Downloads up 12% week on week");
    expect(d.sent[0]).toContain("https://dash.example/analyst");
  });

  it("refuses clearly when there is no report to send", async () => {
    const d = deps({ latestReport: async () => null });
    const result = await runJarvisAction("send_report", {}, d);

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ ok: false, error: expect.stringContaining("no analyst report") });
    expect(d.sent).toEqual([]);
  });

  it("reports a Telegram failure as a failure, never as sent", async () => {
    const d = deps({ send: async () => ({ sent: false, reason: "Telegram 403: bot was kicked" }) });
    const result = await runJarvisAction("send_report", {}, d);

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ ok: false, error: "Telegram 403: bot was kicked" });
  });
});

describe("send_telegram", () => {
  it("labels the message as Jarvis's and escapes what it was given", async () => {
    const d = deps();
    const result = await runJarvisAction("send_telegram", { text: "  <b>Revenue</b> & more  " }, d);

    expect(result.status).toBe(200);
    expect(d.sent).toEqual([`${JARVIS_LABEL}\n&lt;b&gt;Revenue&lt;/b&gt; &amp; more`]);
    expect(result.body).toMatchObject({ ok: true, sent: true, text: "<b>Revenue</b> & more" });
  });

  it.each([
    ["an empty message", { text: "   " }],
    ["no text at all", {}],
    ["text that is not text", { text: 42 }],
    ["a message over the limit", { text: "x".repeat(MAX_MESSAGE_CHARS + 1) }],
  ])("refuses %s", async (_name, args) => {
    const d = deps();
    const result = await runJarvisAction("send_telegram", args, d);

    expect(result.status).toBe(422);
    expect(d.sent).toEqual([]);
  });

  it("refuses a message that would outgrow Telegram's limit once escaped", async () => {
    // Every & becomes five characters. A thousand of them fit the character
    // limit here and would still be rejected whole by Telegram.
    const d = deps();
    const result = await runJarvisAction("send_telegram", { text: "&".repeat(MAX_MESSAGE_CHARS) }, d);

    expect(result.status).toBe(422);
    expect(d.sent).toEqual([]);
    expect(`${JARVIS_LABEL}\n${"&amp;".repeat(MAX_MESSAGE_CHARS)}`.length).toBeGreaterThan(TELEGRAM_LIMIT);
  });

  it("reports a Telegram failure as a failure, never as sent", async () => {
    const d = deps({ send: async () => ({ sent: false, reason: "Telegram is not configured" }) });
    const result = await runJarvisAction("send_telegram", { text: "hello" }, d);

    expect(result.status).toBe(502);
  });
});
