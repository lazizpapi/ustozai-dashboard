-- UstozAI's own product and business metrics.
--
-- Everything else in this database describes the store pages around the app.
-- These tables describe the app: who is using it, for how long, and what they
-- pay. No store API reports any of it.
--
-- Filled by pulling UstozAI's admin API rather than by anyone pushing to us.

-- ---------------------------------------------------------------------------
-- active_users_daily: relax the weekly column
-- ---------------------------------------------------------------------------
--
-- Migration 0013 required wau alongside dau and mau, because the design then
-- was that the app backend would push all three. The API we now pull from
-- reports daily and monthly figures and has no weekly bucket at all, so the
-- not-null constraint would reject every row we collect.
--
-- The nesting rule survives, it just skips the parts that are absent: a
-- missing weekly figure must not be readable as "zero people that week".

alter table active_users_daily alter column wau drop not null;

alter table active_users_daily drop constraint active_users_windows_nest;

alter table active_users_daily add constraint active_users_windows_nest
  check (
    (wau is null or dau <= wau)
    and (wau is null or mau is null or wau <= mau)
    and (wau is not null or mau is null or dau <= mau)
  );

alter table active_users_daily alter column mau drop not null;

comment on column active_users_daily.wau is
  'Null when the source reports no weekly bucket, which is the case for the '
  'admin API. Null means unknown, never zero.';

-- ---------------------------------------------------------------------------
-- app_engagement_daily: how much the app was used
-- ---------------------------------------------------------------------------
--
-- Views are deliberately separate from active users. The API document labels
-- /statistics/views/daily as the DAU chart, but it returns a figure roughly
-- twenty-five times larger, so the two are stored under names that cannot be
-- confused for one another.

create table app_engagement_daily (
  date            date primary key,
  -- Screen or page views for the day, as reported.
  views           integer check (views >= 0),
  total_logins    integer check (total_logins >= 0),
  -- Average session length. Fractional, so stored as numeric, not integer.
  average_minutes numeric(10, 2) check (average_minutes >= 0),
  collected_at    timestamptz not null default now()
);

comment on table app_engagement_daily is
  'Daily engagement from UstozAI''s admin API. Views are page views, not '
  'active users: the two differ by more than an order of magnitude and the '
  'API document conflates them.';

create index app_engagement_daily_recent_idx on app_engagement_daily (date desc);

alter table app_engagement_daily enable row level security;

create policy "authenticated read" on app_engagement_daily
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- revenue_daily: takings per day, per payment provider
-- ---------------------------------------------------------------------------
--
-- One row per day per provider, plus a row where provider = 'ALL' carrying
-- the day's own total as the API reports it. The total is stored rather than
-- derived so that a disagreement between it and the sum of its providers is
-- visible instead of being silently papered over.
--
-- Amounts are stored exactly as the API returns them. The unit is not
-- documented in anything we hold, and dividing by a guessed hundred would be
-- a hundredfold error in the most quotable number in the company.

create table revenue_daily (
  date         date not null,
  provider     text not null,
  amount       numeric(16, 2) not null,
  transactions integer not null default 0 check (transactions >= 0),
  collected_at timestamptz not null default now(),
  primary key (date, provider)
);

comment on table revenue_daily is
  'Daily takings by payment provider. provider = ''ALL'' is the day total as '
  'reported, kept alongside the per-provider rows so the two can be compared '
  'rather than assumed equal.';

comment on column revenue_daily.amount is
  'Exactly as the payment API reports it. The unit is unconfirmed, so nothing '
  'downstream should scale this without checking first.';

create index revenue_daily_recent_idx on revenue_daily (date desc);

alter table revenue_daily enable row level security;

create policy "authenticated read" on revenue_daily
  for select to authenticated using (true);
