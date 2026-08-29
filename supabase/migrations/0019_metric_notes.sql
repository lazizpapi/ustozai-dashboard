-- One AI-written note per notable metric movement, kept forever.
--
-- The dashboard has always been able to show that a number moved. Nobody has
-- ever been told why, and the answer was reconstructed by hand every time: open
-- the releases, check the reviews, remember what marketing did that week. This
-- is that reconstruction, written down on the day the movement happened, while
-- the surrounding data still says what it said.
--
-- The note is written from this dashboard's own data and nothing else, so it
-- can be wrong about the world in one specific way: a cause we do not measure,
-- a blogger or an exam season, is invisible to it. That is why the note is
-- allowed to conclude there is no clear driver, and why no_clear_driver is a
-- column rather than a phrasing convention. A note that always finds a reason
-- is a note that invents them, and an invented cause is worse than silence
-- because decisions get made on it.

create table metric_notes (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- The dashboard's stable name for the figure that moved, matching
  -- src/lib/metric-keys.ts. A check constraint rather than a lookup table:
  -- adding a metric is a migration either way, since it also needs a rule.
  metric_key      text not null check (metric_key in (
    'ios_downloads', 'android_installs',
    'education_rank_ios', 'education_rank_android',
    'ios_rating', 'android_rating',
    'revenue', 'active_users',
    'telegram_members', 'instagram_followers', 'youtube_subscribers'
  )),
  -- The Tashkent day the movement describes, which is not always the day the
  -- note was written: a slump is detected against the fortnight behind it.
  movement_date   date not null,
  direction       text not null check (direction in ('up', 'down')),
  -- The movement in words, as the alert stated it. Stored rather than derived
  -- so the feed can restate a movement from months ago without re-querying
  -- tables that have moved on since.
  magnitude       text not null,
  status          text not null check (status in ('ok', 'failed')),
  -- Uzbek, Latin script. Null exactly when status is 'failed'.
  note_uz         text,
  no_clear_driver boolean,
  -- What the model actually read: [{source, fact}], citing the tools it called.
  -- Kept for the reason analyst_reports keeps its pack: months later, a wrong
  -- note has to be traceable to either the reasoning or the inputs.
  evidence        jsonb,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  error           text,
  -- The identity of a movement, and the reason a re-run is free. Without it a
  -- second daily run would pay for a second opinion on the same day's news.
  unique (metric_key, movement_date)
);

comment on table metric_notes is
  'AI notes explaining notable metric movements, written from dashboard data '
  'only. status ''failed'' keeps a row for a movement the model could not '
  'explain, so a missing note is never mistaken for a quiet day.';

comment on column metric_notes.no_clear_driver is
  'True when the data showed no plausible driver. An expected outcome, not a '
  'failure: the alternative is a model that invents a cause every time.';

create index metric_notes_recent_idx on metric_notes (created_at desc);

alter table metric_notes enable row level security;

create policy "authenticated read" on metric_notes
  for select to authenticated using (true);
