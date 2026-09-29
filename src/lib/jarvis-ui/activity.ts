/**
 * What Jarvis is doing right now, as published by the agent on the
 * `jarvis.activity` data topic (see src/activity.py for the sender).
 *
 * Wire format, version 1:
 *   {"v":1,"phase":"start","key":"<call id>","label":"Searching the web"}
 *   {"v":1,"phase":"note","key":"team_draft","label":"...","ttl_s":120}
 *   {"v":1,"phase":"done","key":"<call id>"}
 *
 * Everything received is checked before it can reach the screen. Every entry
 * expires on its own, so a lost `done` can never leave a line stuck.
 */

export const ACTIVITY_TOPIC = 'jarvis.activity';
/** Up while Jarvis says its farewell after ending the call: the exit is planned. */
export const CALL_ENDING_KEY = 'call_ending';
export const START_TTL_MS = 45_000;
export const MAX_ENTRIES = 8;
const MAX_LABEL_CHARS = 120;
const MAX_KEY_CHARS = 128;
const MAX_TTL_S = 600;

export type ActivityEvent =
  | { phase: 'start' | 'note'; key: string; label: string; ttlMs: number }
  | { phase: 'done'; key: string };

export interface ActivityEntry {
  key: string;
  label: string;
  expiresAt: number;
}

export type ActivityState = readonly ActivityEntry[];

const decoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

/** A well-formed event from the agent, or null for anything else. */
export function parseActivity(bytes: Uint8Array): ActivityEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;

  const key = cleanText(data.key, MAX_KEY_CHARS);
  if (!key) return null;
  if (data.phase === 'done') return { phase: 'done', key };
  if (data.phase !== 'start' && data.phase !== 'note') return null;

  const label = cleanText(data.label, MAX_LABEL_CHARS);
  if (!label) return null;

  let ttlMs = START_TTL_MS;
  if (data.ttl_s !== undefined) {
    const ttl = data.ttl_s;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_S) {
      return null;
    }
    ttlMs = ttl * 1000;
  }
  return { phase: data.phase, key, label, ttlMs };
}

/** The state after one event, received at `now` (the browser's clock, never the agent's). */
export function applyActivity(
  state: ActivityState,
  event: ActivityEvent,
  now: number
): ActivityState {
  if (event.phase === 'done') {
    const index = state.findIndex((entry) => entry.key === event.key);
    return index === -1 ? state : [...state.slice(0, index), ...state.slice(index + 1)];
  }

  const entry: ActivityEntry = { key: event.key, label: event.label, expiresAt: now + event.ttlMs };
  const kept = event.phase === 'note' ? state.filter((e) => e.key !== event.key) : state;
  return [...kept, entry].slice(-MAX_ENTRIES);
}

/** Drops entries that outlived their time. Returns the same state when nothing changed. */
export function pruneActivity(state: ActivityState, now: number): ActivityState {
  const live = state.filter((entry) => entry.expiresAt > now);
  return live.length === state.length ? state : live;
}

/** The line to show: the most recent thing still going on. */
export function currentLabel(state: ActivityState): string | null {
  return state.at(-1)?.label ?? null;
}

/** Whether Jarvis has said it is ending the call. */
export function isCallEnding(state: ActivityState): boolean {
  return state.some((entry) => entry.key === CALL_ENDING_KEY);
}

/** When the next entry expires, so the caller can wake up exactly then. */
export function nextExpiry(state: ActivityState): number | null {
  return state.length ? Math.min(...state.map((entry) => entry.expiresAt)) : null;
}
