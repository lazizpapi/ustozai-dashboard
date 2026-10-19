import { describe, expect, it, vi } from "vitest";

import {
  notifyOutage,
  outageMessage,
  reportOutage,
  reportWithFreshness,
  shouldAlert,
  type RunSummary,
} from "./outage";

/**
 * When the daily report stops being written, everything that reads "the
 * latest report" keeps serving the last good one. From 27 September 2026 the
 * OpenAI account had no credits, every run failed for nineteen days, and
 * Jarvis's morning briefing went on quoting the report of 26 September as
 * the latest without anyone noticing. These pin the remedies: say how old a
 * report is, and say so in the team chat when the runs keep failing.
 */

const NO_CREDITS =
  "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings";

// The run is at 06:40 in Tashkent, 01:40 UTC.
const run = (day: string, status: RunSummary["status"], error: string | null = null): RunSummary => ({
  createdAt: `${day}T01:40:07.000Z`,
  status,
  error,
});

/** Newest first, the order recentAnalystRuns returns. */
function failingSince(firstFailedDay: number, lastFailedDay: number, error = NO_CREDITS): RunSummary[] {
  const failed: RunSummary[] = [];
  for (let day = lastFailedDay; day >= firstFailedDay; day -= 1) {
    failed.push(run(`2026-10-${String(day).padStart(2, "0")}`, "failed", error));
  }
  return [...failed, run("2026-09-30", "ok")];
}

describe("reportOutage", () => {
  it("is nothing while the newest run wrote a report", () => {
    expect(reportOutage([run("2026-10-15", "ok"), run("2026-10-14", "failed", NO_CREDITS)])).toBeNull();
    expect(reportOutage([])).toBeNull();
  });

  it("counts the days in a row without a report, from the first, in plain words", () => {
    expect(reportOutage(failingSince(1, 15))).toEqual({
      failedDays: 15,
      since: "2026-10-01",
      lastWritten: "2026-09-30",
      reason: "the OpenAI account has run out of credits",
    });
  });

  it("counts a day once, however many times it was retried by hand", () => {
    const retried = [
      run("2026-10-02", "failed", NO_CREDITS),
      { ...run("2026-10-01", "failed", NO_CREDITS), createdAt: "2026-10-01T09:00:00.000Z" },
      run("2026-10-01", "failed", NO_CREDITS),
      run("2026-09-30", "ok"),
    ];
    expect(reportOutage(retried)?.failedDays).toBe(2);
  });

  it("is nothing when a run by hand fails after the morning's report was written", () => {
    expect(
      reportOutage([
        { ...run("2026-10-15", "failed", NO_CREDITS), createdAt: "2026-10-15T05:00:00.000Z" },
        run("2026-10-15", "ok"),
      ]),
    ).toBeNull();
  });

  it("does not count a day that had a report, even if a later run that day failed", () => {
    const outage = reportOutage([
      run("2026-10-16", "failed", NO_CREDITS),
      { ...run("2026-10-15", "failed", NO_CREDITS), createdAt: "2026-10-15T05:00:00.000Z" },
      run("2026-10-15", "ok"),
    ]);
    expect(outage).toMatchObject({ failedDays: 1, since: "2026-10-16", lastWritten: "2026-10-15" });
  });

  it("counts a refusal over broken collectors as a day without a report, and says why", () => {
    const outage = reportOutage([
      run("2026-10-02", "stale-data", "collectors failing: play, appstore"),
      run("2026-10-01", "ok"),
    ]);
    expect(outage).toEqual({
      failedDays: 1,
      since: "2026-10-02",
      lastWritten: "2026-10-01",
      reason: "data collectors were failing (play, appstore), so it refused to write from bad numbers",
    });
  });

  it("names the Anthropic account when that is the one out of credits", () => {
    const anthropic =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too ' +
      'low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    expect(reportOutage([run("2026-10-20", "failed", anthropic), run("2026-10-19", "ok")])?.reason).toBe(
      "the Anthropic account has run out of credits",
    );
  });

  it("passes on any other error briefly, and admits when the last good report is out of sight", () => {
    const outage = reportOutage([run("2026-10-02", "failed", `report was cut off (max_output_tokens)\n${"x".repeat(300)}`)]);
    expect(outage?.reason).toBe("the last attempt failed with: report was cut off (max_output_tokens)");
    expect(outage?.lastWritten).toBeNull();
  });
});

describe("shouldAlert", () => {
  it("speaks up on the second day without a report, then once a week while it lasts", () => {
    const alerted = Array.from({ length: 20 }, (_, i) => i + 1).filter((failedDays) =>
      shouldAlert({ failedDays, since: "2026-10-01", lastWritten: null, reason: "x" }),
    );
    expect(alerted).toEqual([2, 9, 16]);
  });
});

describe("outageMessage", () => {
  it("tells the team chat what stopped, since when, and what the dashboard is showing instead", () => {
    const message = outageMessage(reportOutage(failingSince(1, 2))!, "https://dash.example/analyst");
    expect(message).toBe(
      "🔴 <b>The daily report has failed 2 days in a row</b>\n" +
        "Since Thursday 1 October: the OpenAI account has run out of credits.\n" +
        "The dashboard and Jarvis are still showing the report of Wednesday 30 September.\n" +
        "https://dash.example/analyst",
    );
  });

  it("escapes what came from an error, because the chat reads HTML", () => {
    const message = outageMessage({
      failedDays: 2,
      since: "2026-10-01",
      lastWritten: null,
      reason: "the last attempt failed with: <b>&",
    });
    expect(message).toContain("the last attempt failed with: &lt;b&gt;&amp;.");
    expect(message).not.toContain("still showing");
  });
});

describe("notifyOutage", () => {
  const send = () => vi.fn(async () => ({ sent: true }));

  it("posts on the second day without a report", async () => {
    const post = send();
    const result = await notifyOutage({ silent: false, recentRuns: async () => failingSince(1, 2), send: post });
    expect(post).toHaveBeenCalledOnce();
    expect(result).toEqual({ sent: true });
  });

  it("posts once a day: a second failed run on an alert day stays quiet", async () => {
    const post = send();
    const twiceToday = [
      { ...run("2026-10-02", "failed", NO_CREDITS), createdAt: "2026-10-02T06:00:00.000Z" },
      ...failingSince(1, 2),
    ];
    await notifyOutage({ silent: false, recentRuns: async () => twiceToday, send: post });
    expect(post).not.toHaveBeenCalled();
  });

  it("stays quiet on other days, on a run by hand, and when the runs cannot be read", async () => {
    const post = send();
    await notifyOutage({ silent: false, recentRuns: async () => failingSince(1, 3), send: post });
    await notifyOutage({ silent: true, recentRuns: async () => failingSince(1, 2), send: post });
    const unreadable = await notifyOutage({
      silent: false,
      recentRuns: async () => {
        throw new Error("database down");
      },
      send: post,
    });
    expect(post).not.toHaveBeenCalled();
    expect(unreadable).toEqual({ sent: false, reason: "database down" });
  });
});

describe("reportWithFreshness", () => {
  // Thursday 15 October 2026, 10:00 in Tashkent.
  const NOW = new Date("2026-10-15T05:00:00Z");
  const report = {
    id: "r1",
    createdAt: "2026-09-26T01:40:07.000Z",
    status: "ok" as const,
    health: "yellow" as const,
    headline: "Installs held",
    report: null,
    model: "gpt-5.6",
    error: null,
  };

  it("says how old the report is and why no newer one exists, so Jarvis says it first", () => {
    const runs = [...failingSince(1, 15)];
    runs.splice(runs.length - 1, 1, run("2026-09-30", "failed", NO_CREDITS));
    const answer = reportWithFreshness(report, [...runs, run("2026-09-26", "ok")], NOW);
    expect(answer).toMatchObject({ id: "r1", writtenOn: "2026-09-26", ageDays: 19 });
    expect(answer.note).toBe(
      "This report was written on Saturday 26 September, 19 days ago. The last 16 daily runs, " +
        "since Wednesday 30 September, all failed: the OpenAI account has run out of credits. " +
        "Say how old it is before using it, and treat its figures as out of date.",
    );
  });

  it("puts the note first, where a result cut short for Jarvis still keeps it", () => {
    const answer = reportWithFreshness(report, failingSince(1, 15), NOW);
    expect(Object.keys(answer)[0]).toBe("note");
  });

  it("adds no note to this morning's report, or to yesterday's before today's run", () => {
    const fresh = { ...report, createdAt: "2026-10-15T01:40:07.000Z" };
    expect(reportWithFreshness(fresh, [run("2026-10-15", "ok")], NOW)).toEqual({
      ...fresh,
      writtenOn: "2026-10-15",
      ageDays: 0,
    });
    const yesterday = { ...report, createdAt: "2026-10-14T01:40:07.000Z" };
    expect(reportWithFreshness(yesterday, [run("2026-10-14", "ok")], NOW)).not.toHaveProperty("note");
  });

  it("flags an old report even when no failure explains it, such as the schedule stopping", () => {
    const old = { ...report, createdAt: "2026-10-10T01:40:07.000Z" };
    expect(reportWithFreshness(old, [run("2026-10-10", "ok")], NOW).note).toBe(
      "This report was written on Saturday 10 October, 5 days ago. " +
        "Say how old it is before using it, and treat its figures as out of date.",
    );
  });

  it("says why there is no report at all", () => {
    expect(reportWithFreshness(null, [run("2026-10-15", "failed", NO_CREDITS)], NOW)).toEqual({
      available: false,
      note: "The latest run, on Thursday 15 October, failed: the OpenAI account has run out of credits.",
    });
    expect(reportWithFreshness(null, [], NOW)).toEqual({ available: false });
  });
});
