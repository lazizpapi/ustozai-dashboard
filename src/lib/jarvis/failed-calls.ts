import { z } from "zod";

import type { SessionScope } from "@/lib/gate";
import type { Role } from "@/lib/roles";

import { DEPARTMENT_NAMES } from "./authority";
import { callLength, FAILED_START_REASONS, type FailedStartReason, type JarvisCall } from "./calls";
import type { JarvisResponse } from "./handle";
import { personName } from "./person-name";

/**
 * A call that never got going, as the call screen saw it: Jarvis never joined,
 * never got ready or dropped out, or the caller gave up waiting. Jarvis cannot
 * record these, because it was never there, so on 1 October 2026 a failed
 * first call left no trace anywhere.
 *
 * The screen reports it with the session cookie. The department comes from the
 * cookie and must match the room's own name, so a report can only land in the
 * caller's own department's log, and only once per room.
 */

/** At most this many failed calls from one department in FAILURE_WINDOW_MS. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_WAIT_S = 60 * 60;

const ReportSchema = z.object({
  room: z.string().max(200),
  identity: z.string().max(200),
  reason: z.enum(FAILED_START_REASONS),
  waited_s: z.number().int().min(0).max(MAX_WAIT_S),
  person: z.unknown().optional(),
});

/** The room and identity the dashboard minted together (call-token.ts). */
const ROOM = /^jarvis_([a-z]+)_([0-9a-f]{4,32})$/;

export type FailedCallInput = {
  role: Role | null;
  scope: SessionScope | null;
  body: unknown;
  now: Date;
  alreadyLogged: (room: string) => Promise<boolean>;
  failuresLately: (role: Role, since: Date) => Promise<number>;
  save: (call: JarvisCall) => Promise<void>;
};

function summaryFor(reason: FailedStartReason, waitedS: number): string {
  switch (reason) {
    case "gave_up":
      return `Gave up after waiting ${callLength(waitedS)} for Jarvis.`;
    case "dropped":
      return `Jarvis dropped out ${callLength(waitedS)} into the call.`;
    default:
      return `Waited ${callLength(waitedS)} for Jarvis.`;
  }
}

function belongsTo(role: Role, room: string, identity: string): boolean {
  const match = ROOM.exec(room);
  return match !== null && match[1] === role && identity === `${role}_${match[2]}`;
}

export async function recordFailedCall(input: FailedCallInput): Promise<JarvisResponse> {
  const { role, scope } = input;
  if (!role) return { status: 401, body: { ok: false, error: "Sign in first." } };
  if (scope !== "person") {
    return { status: 403, body: { ok: false, error: "Only a person's call screen reports a failed call." } };
  }

  const parsed = ReportSchema.safeParse(input.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: 400, body: { ok: false, error: `${issue?.path.join(".") || "report"}: ${issue?.message ?? "invalid"}` } };
  }
  const report = parsed.data;
  if (!belongsTo(role, report.room, report.identity)) {
    return { status: 400, body: { ok: false, error: "That call is not this department's." } };
  }

  try {
    if (await input.alreadyLogged(report.room)) return { status: 200, body: { ok: true } };
    const since = new Date(input.now.getTime() - FAILURE_WINDOW_MS);
    if ((await input.failuresLately(role, since)) >= MAX_FAILURES) {
      return { status: 429, body: { ok: false, error: "Too many failed calls reported just now." } };
    }

    const person = personName(report.person);
    const department = DEPARTMENT_NAMES[role];
    await input.save({
      room: report.room,
      identity: report.identity,
      role,
      caller_name: person ? `${person} (${department})` : department,
      started_at: new Date(input.now.getTime() - report.waited_s * 1000).toISOString(),
      duration_s: 0,
      tools_used: [],
      input_tokens: 0,
      output_tokens: 0,
      close_reason: report.reason,
      summary: summaryFor(report.reason, report.waited_s),
    });
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return {
      status: 500,
      body: { ok: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}
