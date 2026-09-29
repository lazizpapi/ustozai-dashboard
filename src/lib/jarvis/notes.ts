import { z } from "zod";

import type { Role } from "@/lib/roles";

import type { JarvisResponse } from "./handle";

/**
 * Notes and reminders a department asks Jarvis to keep.
 *
 * Sign-in is per department, so a note belongs to the department, not to one
 * person: anyone signed in as marketing hears marketing's reminders. A note
 * with a due day is a reminder; Jarvis says it at the start of that
 * department's calls from that day on, until someone asks it to clear it.
 *
 * Jarvis saves or clears a note only after reading it back and hearing a yes
 * (the agent's confirmation gate). This endpoint checks the shape and keeps
 * every department inside its own notes: clearing another department's note
 * is "not found", the same answer as a note that never existed.
 */

export type JarvisNote = {
  id: string;
  text: string;
  /** The Tashkent day a reminder is due, or null for a plain note. */
  due_on: string | null;
  created_at: string;
};

export type NewNote = { text: string; due_on: string | null };

export type NotesDeps = {
  list: (role: Role) => Promise<JarvisNote[]>;
  save: (role: Role, note: NewNote) => Promise<JarvisNote>;
  /** True when a note of this department was cleared. */
  clear: (role: Role, id: string) => Promise<boolean>;
};

export type NotesRequest = { role: Role | null; method: string; body: unknown };

const MAX_NOTE_CHARS = 500;

const NoteAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    text: z.string().trim().min(1).max(MAX_NOTE_CHARS),
    due_on: z.iso.date().nullish(),
  }),
  z.object({ action: z.literal("clear"), id: z.uuid() }),
]);

function failed(status: number, error: string): JarvisResponse {
  return { status, body: { ok: false, error } };
}

async function act(role: Role, body: unknown, deps: NotesDeps): Promise<JarvisResponse> {
  const parsed = NoteAction.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  const action = parsed.data;
  if (action.action === "save") {
    const note = await deps.save(role, { text: action.text, due_on: action.due_on ?? null });
    return { status: 200, body: { ok: true, note } };
  }
  if (!(await deps.clear(role, action.id))) {
    return failed(404, `No open note ${action.id} for ${role}.`);
  }
  return { status: 200, body: { ok: true, cleared: action.id } };
}

export async function handleNotes(request: NotesRequest, deps: NotesDeps): Promise<JarvisResponse> {
  const { role, method, body } = request;
  if (!role) return failed(403, "X-Jarvis-Role is required: say which department is asking.");
  try {
    if (method === "GET") return { status: 200, body: { ok: true, notes: await deps.list(role) } };
    if (method === "POST") return await act(role, body, deps);
    return failed(405, "Notes take GET or POST.");
  } catch (error) {
    return failed(500, error instanceof Error ? error.message : String(error));
  }
}
