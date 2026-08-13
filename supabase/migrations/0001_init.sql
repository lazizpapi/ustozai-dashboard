-- UstozAI store metrics dashboard: initial schema.
--
-- Two conventions run through every table here, both deliberate:
--
-- 1. A missing row and a NULL rank mean different things. If a poll succeeds but
--    the app is not in the returned feed, we write a row with rank = NULL. If the
--    poll itself fails, we write NO row and record the failure in collector_runs.
--    Conflating the two would draw a confident flat line over a broken feed.
--
-- 2. Every row a collector writes carries the run's captured_at, truncated to the
--    hour by the caller. Reruns of the same cron hour upsert rather than duplicate.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- apps
-- ---------------------------------------------------------------------------

create table apps (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null check (platform in ('ios', 'android')),
  store_id       text not null,
  name           text not null,
  genre          text,
  created_at     timestamptz not null default now(),
  unique (platform, store_id)
);

comment on column apps.store_id is
  'Apple numeric track id, or Android package name.';

insert into apps (platform, store_id, name, genre) values
  ('ios',     '6504815934',          'Ustoz AI', 'Education'),
  ('android', 'uz.uztozedu.ustozai', 'Ustoz AI', 'Education');

-- ---------------------------------------------------------------------------
-- metric_snapshots: rating, rating count, cumulative installs
-- ---------------------------------------------------------------------------

create table metric_snapshots (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references apps (id) on delete cascade,
  country        text not null,
  captured_at    timestamptz not null,
  rating         numeric(6, 5),
  rating_count   integer,
  install_count  bigint,
  install_label  text,
  version        text,
  unique (app_id, country, captured_at)
);

comment on column metric_snapshots.install_count is
  'Google Play only. Apple publishes no install count at any tier. Exact integer '
  'parsed from the Play payload, e.g. 530577.';
comment on column metric_snapshots.install_label is
  'The rounded string Play displays alongside it, e.g. "500K+". Kept for the UI '
  'so we never imply more precision than Play shows publicly.';

create index metric_snapshots_app_country_time_idx
  on metric_snapshots (app_id, country, captured_at desc);

-- ---------------------------------------------------------------------------
-- chart_ranks: position in a store chart
-- ---------------------------------------------------------------------------

create table chart_ranks (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references apps (id) on delete cascade,
  country        text not null,
  chart_type     text not null,
  genre          text not null,
  rank           integer check (rank is null or rank > 0),
  feed_size      integer not null,
  captured_at    timestamptz not null,
  unique (app_id, country, chart_type, genre, captured_at)
);

comment on column chart_ranks.chart_type is
  'topfree | topfreeipad | topgrossing | topgrossingipad | newapps.';
comment on column chart_ranks.genre is
  'Apple genre id such as 6017 for Education, or the literal ''overall'' for the '
  'ungenred chart. A sentinel beats NULL here because NULL breaks unique matching.';
comment on column chart_ranks.rank is
  'NULL means the poll succeeded and the app was outside the feed. A failed poll '
  'writes no row at all. See the header note.';
comment on column chart_ranks.feed_size is
  'How many entries the feed actually returned. Apple caps the legacy RSS at 100 '
  'regardless of the requested limit, so "outside the feed" means outside this many.';

create index chart_ranks_app_time_idx
  on chart_ranks (app_id, country, chart_type, genre, captured_at desc);

-- ---------------------------------------------------------------------------
-- keyword_ranks: position in store search results
-- ---------------------------------------------------------------------------

create table keyword_ranks (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references apps (id) on delete cascade,
  country        text not null,
  keyword        text not null,
  position       integer check (position is null or position > 0),
  result_count   integer not null,
  captured_at    timestamptz not null,
  unique (app_id, country, keyword, captured_at)
);

comment on column keyword_ranks.position is
  'NULL means we searched and the app did not appear. Same convention as rank.';
comment on column keyword_ranks.keyword is
  'Stored exactly as queried. Uzbek terms are tracked in both apostrophe forms '
  '(ta''lim with ASCII, taʼlim with U+02BC) because they return different '
  'result sets and users type both.';

create index keyword_ranks_app_keyword_time_idx
  on keyword_ranks (app_id, country, keyword, captured_at desc);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

create table reviews (
  id                uuid primary key default gen_random_uuid(),
  app_id            uuid not null references apps (id) on delete cascade,
  country           text not null,
  store_review_id   text not null,
  rating            integer not null check (rating between 1 and 5),
  title             text,
  body              text,
  author            text,
  version           text,
  submitted_at      timestamptz,
  first_seen_at     timestamptz not null default now(),
  unique (app_id, store_review_id)
);

create index reviews_app_submitted_idx
  on reviews (app_id, submitted_at desc nulls last);
create index reviews_low_rating_idx
  on reviews (app_id, submitted_at desc) where rating <= 3;

-- ---------------------------------------------------------------------------
-- ios_downloads_daily: App Store Connect, the only source of iOS install counts
-- ---------------------------------------------------------------------------

create table ios_downloads_daily (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references apps (id) on delete cascade,
  date           date not null,
  country        text not null,
  download_type  text not null default 'all',
  source_type    text not null default 'all',
  device         text not null default 'all',
  units          integer not null,
  source         text not null check (source in ('sales', 'analytics')),
  fetched_at     timestamptz not null default now(),
  unique (app_id, date, country, download_type, source_type, device, source)
);

comment on table ios_downloads_daily is
  'Daily, never live. Apple exposes no real-time install counter anywhere, '
  'including inside App Store Connect itself. Sales reports land the next day; '
  'Analytics reports carry a 1 to 2 day completeness lag.';
comment on column ios_downloads_daily.source is
  'sales = /v1/salesReports, one summary row per country per day. '
  'analytics = Analytics App Downloads report, which breaks the same total down '
  'by download type and traffic source. Both are kept so the richer breakdown '
  'can be reconciled against the simpler total rather than silently replacing it.';
comment on column ios_downloads_daily.download_type is
  'first_time | redownload | manual_update | auto_update | restore, or ''all'' '
  'for the undifferentiated sales-report total.';

create index ios_downloads_date_idx on ios_downloads_daily (app_id, date desc);

create table ios_proceeds_daily (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references apps (id) on delete cascade,
  date           date not null,
  country        text not null,
  units          integer not null,
  proceeds       numeric(14, 4) not null,
  currency       text not null,
  fetched_at     timestamptz not null default now(),
  unique (app_id, date, country, currency)
);

-- ---------------------------------------------------------------------------
-- collector_runs: health log
-- ---------------------------------------------------------------------------

-- Not optional. The legacy iTunes RSS is undocumented, and Play parsing depends
-- on an internal payload layout. Both can break without warning and the failure
-- mode is silence, not an exception the user would ever see. Every panel in the
-- UI reads its freshness badge from this table.
create table collector_runs (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  status         text not null check (status in ('ok', 'failed', 'skipped')),
  records        integer not null default 0,
  error          text,
  duration_ms    integer,
  ran_at         timestamptz not null default now()
);

create index collector_runs_source_time_idx
  on collector_runs (source, ran_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- Signed-in team members read. Nobody writes through the anon or authenticated
-- roles: every write goes through the cron routes using the service role key,
-- which bypasses RLS. So there is deliberately no insert, update, or delete
-- policy below.
alter table apps                enable row level security;
alter table metric_snapshots    enable row level security;
alter table chart_ranks         enable row level security;
alter table keyword_ranks       enable row level security;
alter table reviews             enable row level security;
alter table ios_downloads_daily enable row level security;
alter table ios_proceeds_daily  enable row level security;
alter table collector_runs      enable row level security;

create policy "authenticated read" on apps
  for select to authenticated using (true);
create policy "authenticated read" on metric_snapshots
  for select to authenticated using (true);
create policy "authenticated read" on chart_ranks
  for select to authenticated using (true);
create policy "authenticated read" on keyword_ranks
  for select to authenticated using (true);
create policy "authenticated read" on reviews
  for select to authenticated using (true);
create policy "authenticated read" on ios_downloads_daily
  for select to authenticated using (true);
create policy "authenticated read" on ios_proceeds_daily
  for select to authenticated using (true);
create policy "authenticated read" on collector_runs
  for select to authenticated using (true);
