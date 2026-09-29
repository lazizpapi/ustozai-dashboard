-- Notes and reminders a department asks Jarvis to keep.
--
-- Sign-in is per department, so a note belongs to the department: anyone
-- signed in as marketing hears marketing's reminders. A note with a due day
-- is a reminder, which Jarvis says at the start of that department's calls
-- from that day on until someone asks it to clear it. Jarvis writes a row
-- only after reading the note back and hearing a yes, through
-- /api/jarvis/notes, which checks every field first (src/lib/jarvis/notes.ts).
--
-- Clearing is a timestamp rather than a delete, so "did Jarvis drop my
-- reminder" can always be answered.

create table jarvis_notes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  role       text not null check (role in ('ceo', 'marketing', 'product', 'it')),
  text       text not null check (char_length(text) between 1 and 500),
  due_on     date,
  cleared_at timestamptz
);

comment on table jarvis_notes is
  'Notes and reminders a department asked Jarvis to keep. due_on makes a note a '
  'reminder; cleared_at retires it. Written by the agent via /api/jarvis/notes.';

create index jarvis_notes_open_idx on jarvis_notes (role, due_on) where cleared_at is null;

alter table jarvis_notes enable row level security;

-- No read policy: every reader is the service role behind /api/jarvis/notes and
-- the /jarvis/notes page, which both cut the rows to the caller's department.
