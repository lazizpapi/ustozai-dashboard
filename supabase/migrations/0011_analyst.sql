-- The analyst's daily reports.
--
-- One row per run, kept forever. The history is the point: a recommendation is
-- only judgeable against what happened after it, and a report that contradicts
-- last week's should be visible as a contradiction rather than quietly
-- replacing it.
--
-- The briefing the report was written from is stored alongside it. Without
-- that, a wrong conclusion is unattributable months later: there would be no
-- way to tell a reasoning failure from a briefing that was missing the number
-- that would have changed the answer.

create table analyst_reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  -- The window the report describes, in Tashkent days.
  period_from  date not null,
  period_to    date not null,
  status       text not null check (status in ('ok', 'stale-data', 'failed')),
  health       text check (health in ('green', 'yellow', 'red')),
  headline     text,
  report       jsonb,
  pack         jsonb,
  model        text,
  input_tokens  integer,
  output_tokens integer,
  error        text
);

comment on table analyst_reports is
  'Daily AI analysis of the dashboard. status ''stale-data'' means the run '
  'deliberately refused to analyse numbers produced by a broken collector '
  'pipeline; ''failed'' means the model call itself did not produce a valid '
  'report. Both keep a row so a silent gap is impossible to mistake for a '
  'quiet day.';

comment on column analyst_reports.pack is
  'The exact briefing the model was given. Kept so a wrong conclusion can be '
  'traced to either the reasoning or the inputs.';

create index analyst_reports_recent_idx on analyst_reports (created_at desc);

alter table analyst_reports enable row level security;

create policy "authenticated read" on analyst_reports
  for select to authenticated using (true);
