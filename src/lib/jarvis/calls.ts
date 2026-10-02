import { z } from "zod";

import { ROLES } from "@/lib/roles";

import type { JarvisResponse } from "./handle";

/**
 * The record Jarvis leaves when a call ends: who, when, how long, what it used.
 *
 * Checked field by field before it is stored. The agent's process is the
 * least trusted thing that writes to this database, and a record that cannot
 * be read back is worse than none: the call log is where anyone looks after
 * "did Jarvis really say that".
 *
 * Snake case because the sender is Python and the columns are Postgres.
 */

const DAY_SECONDS = 24 * 60 * 60;

const CallSchema = z.object({
  room: z.string().min(1).max(200),
  identity: z.string().min(1).max(200),
  role: z.enum(ROLES),
  caller_name: z.string().max(100).default(""),
  started_at: z.iso.datetime(),
  duration_s: z.number().int().min(0).max(DAY_SECONDS),
  tools_used: z.array(z.string().min(1).max(64)).max(100).default([]),
  input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(0),
  close_reason: z.string().max(64).default(""),
  summary: z.string().max(2000).default(""),
});

export type JarvisCall = z.infer<typeof CallSchema>;

export function parseJarvisCall(
  body: unknown,
): { ok: true; call: JarvisCall } | { ok: false; error: string } {
  const parsed = CallSchema.safeParse(body);
  if (parsed.success) return { ok: true, call: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.join(".") || "record";
  return { ok: false, error: `${where}: ${issue?.message ?? "invalid"}` };
}

export async function recordJarvisCall(
  body: unknown,
  save: (call: JarvisCall) => Promise<void>,
): Promise<JarvisResponse> {
  const parsed = parseJarvisCall(body);
  if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };

  try {
    await save(parsed.call);
    return { status: 200, body: { ok: true } };
  } catch (error) {
    return {
      status: 500,
      body: { ok: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** A call's length for the log: "42 s", "3 min 4 s", "1 h 2 min". */
export function callLength(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${rest} s`;
}

/**
 * Calls that never got going. Jarvis cannot record these, because it was
 * never there; the call screen reports them (failed-calls.ts).
 */
export const FAILED_START_REASONS = ["never_joined", "not_ready", "dropped", "gave_up"] as const;
export type FailedStartReason = (typeof FAILED_START_REASONS)[number];

const FAILED_STARTS: Record<FailedStartReason, string> = {
  never_joined: "Jarvis never joined",
  not_ready: "Jarvis joined but never got ready",
  dropped: "Jarvis dropped out",
  gave_up: "Caller gave up waiting",
};

const UNUSUAL_ENDINGS: Record<string, string> = {
  time_limit: "Reached the time limit",
  second_person: "Someone else joined",
  error: "Ended by an error",
  ...FAILED_STARTS,
};

/** A label for a call that ended in a way worth noticing, or null for a goodbye or hang-up. */
export function unusualEnding(closeReason: string): string | null {
  return UNUSUAL_ENDINGS[closeReason] ?? null;
}

/** True for a call that never got going, as reported by the call screen. */
export function isFailedStart(closeReason: string): closeReason is FailedStartReason {
  return Object.hasOwn(FAILED_STARTS, closeReason);
}

/**
 * The calls to list, without a failed start that Jarvis's own record of the
 * same room contradicts: the screen can give up just as Jarvis gets going.
 */
export function withoutShadowedFailures<T extends { room: string; closeReason: string }>(rows: readonly T[]): T[] {
  const happened = new Set(rows.filter((row) => !isFailedStart(row.closeReason)).map((row) => row.room));
  return rows.filter((row) => !isFailedStart(row.closeReason) || !happened.has(row.room));
}

/** A token count at a glance: 950, 12.4k, 1.3M. */
export function tokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
