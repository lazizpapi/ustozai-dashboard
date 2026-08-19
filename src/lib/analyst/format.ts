import type { AnalystReport } from "./schema";

/**
 * The analyst's daily message for Telegram.
 *
 * A compact version of the report, not the whole thing: the point is that
 * somebody reads it on a phone and knows whether to open the dashboard. The
 * full report lives on /analyst and this links to it.
 */

/** Telegram rejects the entire message above this, so it is a hard ceiling. */
export const TELEGRAM_LIMIT = 4096;

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BADGE = { green: "🟢", yellow: "🟡", red: "🔴" } as const;

const ARROW = { up: "▲", down: "▼", flat: "=" } as const;

/** Trims a single field so one runaway value cannot crowd out every section. */
const cap = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export function formatAnalystMessage(report: AnalystReport, url?: string): string {
  const lines: string[] = [
    `${BADGE[report.health]} <b>${escape(cap(report.headline, 300))}</b>`,
  ];

  if (report.changes.length > 0) {
    lines.push("");
    for (const change of report.changes.slice(0, 4)) {
      lines.push(
        `${ARROW[change.direction]} ${escape(cap(change.metric, 60))}: ${escape(cap(change.detail, 140))}`,
      );
    }
  }

  if (report.recommendations.length > 0) {
    lines.push("", "<b>Do next</b>");
    report.recommendations.slice(0, 3).forEach((recommendation, index) => {
      lines.push(
        `${index + 1}. ${escape(cap(recommendation.action, 160))} ` +
          `<i>(${recommendation.effort} effort)</i>`,
      );
    });
  }

  if (url) lines.push("", `<a href="${escape(url)}">Full report</a>`);

  /*
   * Final guard. Every field above is individually capped, but a report with
   * many changes and long text could still add up past the limit, and Telegram
   * refuses the whole message rather than truncating it — so a message that
   * ran long would mean no report at all that day.
   */
  const message = lines.join("\n");
  return message.length <= TELEGRAM_LIMIT
    ? message
    : `${message.slice(0, TELEGRAM_LIMIT - 20)}…\n\n(trimmed)`;
}
