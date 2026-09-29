import Link from "next/link";
import { BellRing, CalendarClock, ChevronLeft, NotebookPen } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { requireAccess } from "@/app/load";
import { openJarvisNotes } from "@/lib/db/queries";
import { DEPARTMENT_NAMES } from "@/lib/jarvis/authority";
import { tashkentDate } from "@/lib/jarvis/context";
import type { JarvisNote } from "@/lib/jarvis/notes";
import { dueLabel, groupNotes } from "@/lib/jarvis-ui/notes";
import { formatDay } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * What a department asked Jarvis to keep: reminders due now, reminders still
 * to come, and plain notes. Read-only: notes are added and cleared on a call,
 * where Jarvis reads each one back first.
 */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function NoteList({
  title,
  icon: Icon,
  notes,
  meta,
}: {
  title: string;
  icon: Icon;
  notes: JarvisNote[];
  meta: (note: JarvisNote) => string;
}) {
  if (notes.length === 0) return null;
  // An id without spaces: aria-labelledby reads a space as a second id.
  const headingId = `notes-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2
        id={headingId}
        className="text-muted-foreground flex items-center gap-2 text-sm font-medium"
      >
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </h2>
      <ul className="jarvis-glass divide-y divide-white/8 overflow-hidden rounded-[22px]">
        {notes.map((note) => (
          <li key={note.id} className="px-5 py-4">
            <p className="text-foreground text-[15px] leading-6">{note.text}</p>
            <p className="text-muted-foreground mt-1 text-sm">{meta(note)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function readNotes(role: Parameters<typeof openJarvisNotes>[0]) {
  try {
    return { ok: true as const, notes: await openJarvisNotes(role) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function JarvisNotesPage() {
  const role = await requireAccess("/jarvis/notes");
  const result = await readNotes(role);
  const groups = result.ok ? groupNotes(result.notes, tashkentDate(new Date())) : null;
  const empty = groups && groups.due.length + groups.upcoming.length + groups.notes.length === 0;

  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center px-5 md:h-16 md:px-8">
        <Link
          href="/jarvis"
          className="text-foreground/85 hover:text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5 rounded-full text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-[3px]"
        >
          <ChevronLeft className="text-muted-foreground size-4" aria-hidden="true" />
          Jarvis
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 pt-4 pb-16">
        <div className="space-y-2">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Notes and reminders
          </h1>
          <p className="text-muted-foreground max-w-[60ch] text-[15px] leading-6">
            What {DEPARTMENT_NAMES[role]} asked Jarvis to keep. To add or clear one, ask Jarvis on
            a call. It reads each one back before saving.
          </p>
        </div>

        {!result.ok && (
          <p role="status" className="jarvis-glass text-foreground/85 rounded-[22px] px-5 py-4 text-[15px]">
            Notes are not set up yet. {result.error}
          </p>
        )}

        {empty && (
          <p className="jarvis-glass text-foreground/85 rounded-[22px] px-5 py-4 text-[15px] leading-6">
            Nothing kept yet. On a call, try &ldquo;remember that we ship on Fridays&rdquo; or
            &ldquo;remind me on Friday to check the keyword ranks&rdquo;.
          </p>
        )}

        {groups && (
          <>
            <NoteList
              title="Due now"
              icon={BellRing}
              notes={groups.due}
              meta={(note) => `Due ${dueLabel(note.due_on ?? "")}. Jarvis says it at the start of calls.`}
            />
            <NoteList
              title="Coming up"
              icon={CalendarClock}
              notes={groups.upcoming}
              meta={(note) => `Due ${dueLabel(note.due_on ?? "")}`}
            />
            <NoteList
              title="Notes"
              icon={NotebookPen}
              notes={groups.notes}
              meta={(note) => `Saved ${formatDay(note.created_at)}`}
            />
          </>
        )}
      </main>
    </div>
  );
}
