-- Market intelligence: the visible top of the chart, and competitor listing
-- changes. Both are read from responses the hourly poll already fetches, so
-- neither table costs a single extra request to fill.

-- ---------------------------------------------------------------------------
-- chart_apps: who holds the top of each chart, one row per position per day
-- ---------------------------------------------------------------------------
--
-- chart_ranks answers "where are the apps we track"; this answers "who is
-- around us and who is moving". Not keyed on the apps table on purpose: most
-- of the chart is apps we do not track, and forcing rows for them into apps
-- would turn a seed migration into a moving target.
--
-- One row per day, upserted by every hourly poll, so during the day the row
-- is the latest reading and by midnight it is the day's final state. If the
-- chart shrinks below the stored depth mid-day, positions written earlier
-- that day can linger; with Apple's feeds pinned at 100 entries and 20
-- stored, that stays theoretical.

create table chart_apps (
  country      text not null,
  chart_type   text not null,
  genre        text not null,
  -- Asia/Tashkent calendar date, computed by the collector. The poll runs on
  -- UTC hours; bucketing on UTC would split the team's day in two.
  date         date not null,
  rank         integer not null check (rank >= 1),
  store_id     text not null,
  name         text not null,
  captured_at  timestamptz not null,
  primary key (country, chart_type, genre, date, rank)
);

comment on table chart_apps is
  'Top of each tracked App Store chart, one row per position per Tashkent day. '
  'Read from the same RSS payload the rank poll fetches; depth is capped in '
  'code rather than here so widening it is a deploy, not a migration.';

create index chart_apps_lookup_idx on chart_apps (country, chart_type, genre, date desc);

alter table chart_apps enable row level security;

create policy "authenticated read" on chart_apps
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- listing_versions: what an app's store page said, recorded when it changes
-- ---------------------------------------------------------------------------
--
-- Insert-only. A row is written when the content hash of an app's stable
-- listing metadata (title, description, version, screenshots — never ratings
-- or installs) differs from the newest stored row. The first row per app is
-- the baseline from when watching began, not evidence of a change, and the
-- UI treats it that way.

create table listing_versions (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid not null references apps (id) on delete cascade,
  fields        jsonb not null,
  content_hash  text not null,
  detected_at   timestamptz not null default now()
);

comment on table listing_versions is
  'Store listing metadata per app, one row per observed version. A change row '
  'for a competitor is an ASO experiment being run in public; a change row for '
  'us is the record of our own. Hash covers stable metadata only, so rating '
  'drift can never masquerade as a listing change.';

create index listing_versions_app_idx on listing_versions (app_id, detected_at desc);

alter table listing_versions enable row level security;

create policy "authenticated read" on listing_versions
  for select to authenticated using (true);
