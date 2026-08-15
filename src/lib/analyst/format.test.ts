import { describe, expect, it } from "vitest";

import { TELEGRAM_LIMIT, formatAnalystMessage } from "./format";
import type { AnalystReport } from "./schema";

function report(overrides: Partial<AnalystReport> = {}): AnalystReport {
  return {
    health: "yellow",
    headline: "Downloads are flat while impressions rose 12%.",
    changes: [{ metric: "Impressions", detail: "2,721 to 3,048", direction: "up" }],
    causes: [{ claim: "More search traffic", evidence: "impressions up", confidence: "low" }],
    recommendations: [
      { action: "Rework the first screenshot", why: "tap rate 33%", expectedImpact: "+5pp taps", effort: "medium" },
    ],
    competitorWatch: [{ app: "Praktika", note: "held #2" }],
    dataGaps: ["No retention data"],
    ...overrides,
  };
}

describe("formatAnalystMessage", () => {
  it("leads with the health badge and the headline", () => {
    const message = formatAnalystMessage(report());
    expect(message.startsWith("🟡")).toBe(true);
    expect(message).toContain("Downloads are flat");
  });

  it("includes the top recommendations", () => {
    expect(formatAnalystMessage(report())).toContain("Rework the first screenshot");
  });

  it("stays under Telegram's limit even when every field is enormous", () => {
    // Telegram rejects the whole message over 4096 characters, so an
    // unusually rich report must arrive trimmed rather than not at all.
    const big = report({
      headline: "h".repeat(2000),
      changes: Array.from({ length: 40 }, (_, i) => ({
        metric: `metric ${i} `.repeat(20),
        detail: `detail ${i} `.repeat(40),
        direction: "up" as const,
      })),
      recommendations: Array.from({ length: 5 }, (_, i) => ({
        action: `action ${i} `.repeat(50),
        why: `why ${i} `.repeat(50),
        expectedImpact: "x".repeat(400),
        effort: "high" as const,
      })),
      dataGaps: Array.from({ length: 30 }, (_, i) => `gap ${i} `.repeat(30)),
    });

    const message = formatAnalystMessage(big);
    expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });

  it("escapes HTML so a review quote cannot break the markup", () => {
    // parse_mode is HTML; an unescaped angle bracket makes Telegram reject
    // the send outright, which would lose the whole day's report.
    const message = formatAnalystMessage(report({ headline: "Ratings <dropped> & fell" }));

    expect(message).toContain("&lt;dropped&gt;");
    expect(message).toContain("&amp;");
  });

  it("renders a red report with the red badge", () => {
    expect(formatAnalystMessage(report({ health: "red" })).startsWith("🔴")).toBe(true);
  });

  it("handles a report with no recommendations at all", () => {
    const message = formatAnalystMessage(report({ recommendations: [] }));
    expect(message).toContain("Downloads are flat");
    expect(message.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });
});
