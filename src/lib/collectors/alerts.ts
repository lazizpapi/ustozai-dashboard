import { sendTelegramMessage } from "@/lib/digest/telegram";

/**
 * Turning a collector failure into a message somebody actually sees.
 *
 * A source that stops has always been written to collector_runs, shown on the
 * IT panel, and listed in the daily digest. All three require somebody to go
 * and look, and the digest lists it last, under the good news. The Instagram
 * follower count was dead for four days before anybody noticed. That is the
 * failure this closes.
 *
 * Alerts fire on the *change*, never on the state. A source that broke
 * yesterday and is still broken has already been reported; repeating it every
 * hour is how an alert channel becomes something people mute, and a muted
 * channel is worse than no channel because it looks like coverage.
 *
 * This rides the hourly poll rather than the daily run. The daily run is
 * itself a thing that can stop, and an alarm wired into the machine it is
 * meant to watch is not an alarm.
 */

/** Enough of a collector_runs row, or of a fresh outcome, to compare the two. */
export interface SourceStatus {
  source: string;
  status: string;
  error?: string | null;
}

export interface StatusChange {
  broke: { source: string; error: string }[];
  recovered: string[];
}

/** Longer than this and the message stops being readable on a phone. */
const MAX_LISTED = 6;
const MAX_ERROR_CHARS = 160;

/**
 * Shared with the metric alerts, which send into the same channel and would
 * otherwise carry a second copy of the same three replacements.
 */
export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * What changed between the previous run and this one.
 *
 * A source missing from `before` is one we have never recorded, and is
 * reported only when it arrives already failing: a first successful run is not
 * news. A source missing from `now` did not run this time and is left alone,
 * because not running is not the same as passing.
 *
 * Recovery counts only from `failed` to `ok`. A source that goes from failing
 * to skipped has had its handle unset, which is a person deciding to stop
 * collecting rather than a problem solving itself.
 */
export function detectStatusChanges(before: SourceStatus[], now: SourceStatus[]): StatusChange {
  const previous = new Map(before.map((entry) => [entry.source, entry.status]));

  const broke: { source: string; error: string }[] = [];
  const recovered: string[] = [];

  for (const entry of now) {
    const wasFailing = previous.get(entry.source) === "failed";

    if (entry.status === "failed" && !wasFailing) {
      broke.push({ source: entry.source, error: entry.error?.trim() || "failed" });
    } else if (entry.status === "ok" && wasFailing) {
      recovered.push(entry.source);
    }
  }

  return { broke, recovered };
}

/**
 * The message, or null when there is nothing to say.
 *
 * Returning null rather than an empty string so the caller cannot accidentally
 * send a blank message on a quiet hour.
 */
export function formatStatusAlert(change: StatusChange): string | null {
  if (change.broke.length === 0 && change.recovered.length === 0) return null;

  const lines: string[] = [];

  if (change.broke.length > 0) {
    lines.push("<b>Collector stopped</b>");
    for (const entry of change.broke.slice(0, MAX_LISTED)) {
      lines.push(`  ${escapeHtml(entry.source)}: ${escapeHtml(entry.error.slice(0, MAX_ERROR_CHARS))}`);
    }
    const hidden = change.broke.length - MAX_LISTED;
    if (hidden > 0) lines.push(`  and ${hidden} more`);
  }

  if (change.recovered.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("<b>Collecting again</b>");
    lines.push(`  ${change.recovered.slice(0, MAX_LISTED).map(escapeHtml).join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Compare, format, send. Never throws.
 *
 * A collector run must not fail because Telegram is unreachable. The whole
 * point of this function is to report that something went wrong, so it taking
 * the run down with it would be a poor joke.
 */
export async function notifyStatusChanges(
  before: SourceStatus[],
  now: SourceStatus[],
): Promise<void> {
  try {
    const message = formatStatusAlert(detectStatusChanges(before, now));
    if (!message) return;

    const result = await sendTelegramMessage(message);
    if (!result.sent) console.error("could not send collector alert:", result.reason);
  } catch (error) {
    console.error("could not send collector alert:", error);
  }
}
