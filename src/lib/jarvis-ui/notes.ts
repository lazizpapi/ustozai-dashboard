import type { JarvisNote } from "@/lib/jarvis/notes";

export type NoteGroups = { due: JarvisNote[]; upcoming: JarvisNote[]; notes: JarvisNote[] };

/** Reminders due by today, reminders still to come, and plain notes, newest first. */
export function groupNotes(all: readonly JarvisNote[], today: string): NoteGroups {
  const byDue = (a: JarvisNote, b: JarvisNote) => (a.due_on ?? "").localeCompare(b.due_on ?? "");
  const reminders = all.filter((n) => n.due_on !== null);
  return {
    due: reminders.filter((n) => (n.due_on ?? "") <= today).sort(byDue),
    upcoming: reminders.filter((n) => (n.due_on ?? "") > today).sort(byDue),
    notes: all
      .filter((n) => n.due_on === null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "Wed 30 Sept" for a YYYY-MM-DD due day, read as the calendar day itself. */
export function dueLabel(dueOn: string): string {
  return DAY.format(new Date(`${dueOn}T00:00:00Z`)).replace(",", "");
}
