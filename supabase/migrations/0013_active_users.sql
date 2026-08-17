-- Active users, pushed from the UstozAI app's own backend.
--
-- Every other table here is filled by a collector we control, reading a store
-- or a social platform. This one is filled by somebody else's daily job, so
-- the constraints are the contract: they are what stops a bug on their side
-- from becoming a wrong DAU on the wall display.
--
-- The store APIs cannot answer this question at all. Apple reports sessions
-- and active devices only for users who opted into sharing analytics, and
-- Google reports nothing comparable, so the app's own backend is the only
-- source that can count every user on both platforms.

create table active_users_daily (
  -- The Tashkent calendar day the counts describe.
  date        date not null,
  -- 'all' is the combined figure. Per-platform rows are optional and may
  -- arrive later without disturbing the combined series.
  platform    text not null default 'all'
                check (platform in ('all', 'ios', 'android', 'web')),
  dau         integer not null check (dau >= 0),
  wau         integer not null check (wau >= 0),
  mau         integer not null check (mau >= 0),
  -- When the push landed, as opposed to the day it describes. A gap between
  -- the two is how a stalled backend job becomes visible.
  received_at timestamptz not null default now(),

  primary key (date, platform),

  -- Somebody active today is necessarily active this week and this month.
  -- Enforced in the database as well as at the endpoint, because the endpoint
  -- is one deploy away from being bypassed and this invariant is the one that
  -- makes the stickiness ratio meaningful.
  constraint active_users_windows_nest check (dau <= wau and wau <= mau)
);

comment on table active_users_daily is
  'Daily, weekly and monthly active users pushed by the app backend over '
  '/api/ingest/active-users. Not derivable from any store API: Apple counts '
  'only analytics opt-ins and Google publishes nothing equivalent.';

comment on column active_users_daily.received_at is
  'Arrival time, not the day described. A stale received_at against a recent '
  'date means the sender stopped pushing.';

create index active_users_daily_recent_idx on active_users_daily (date desc);

alter table active_users_daily enable row level security;

create policy "authenticated read" on active_users_daily
  for select to authenticated using (true);
