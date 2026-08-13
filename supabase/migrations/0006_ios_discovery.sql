-- The top of the funnel: how many people saw the listing, and how many opened it.
--
-- Downloads alone cannot tell you whether a good week came from more people
-- finding the app or from more of the same people deciding to install it. Those
-- two need opposite responses, so the numbers that separate them are the ones
-- worth keeping. This table holds impressions and product page views; the
-- bottom of the funnel already lives in ios_downloads_daily.
--
-- Same source and the same restatement rule as the analytics download rows:
-- Apple republishes a day as late data arrives, and only the newest
-- processingDate instance for a date may be used. collect-discovery.ts clears
-- and rewrites the dates each instance covers rather than upserting, because a
-- restatement can carry a different set of dimension combinations than the one
-- it supersedes and upserting alone would strand the difference.

create table ios_discovery_daily (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references apps (id) on delete cascade,
  date         date not null,
  country      text not null,
  event        text not null,
  page_type    text not null default 'all',
  source_type  text not null default 'all',
  device       text not null default 'all',
  units        integer not null,
  fetched_at   timestamptz not null default now(),
  unique (app_id, date, country, event, page_type, source_type, device)
);

comment on table ios_discovery_daily is
  'Analytics "App Store Discovery and Engagement Detailed" report. Daily and a '
  'day or two in arrears, like every other Apple analytics source. No source '
  'column: unlike ios_downloads_daily there is only one report behind this, so '
  'there is nothing to reconcile against.';

comment on column ios_discovery_daily.event is
  'Impression, product page view and similar, normalised to lower_snake_case. '
  'Deliberately not constrained to a whitelist: the exact vocabulary was '
  'unverified when this was written, and an unrecognised event should land '
  'here visibly rather than be dropped on the way in.';

comment on column ios_discovery_daily.units is
  'The report''s Counts column only. Unique Counts is deliberately not stored. '
  'Unique device counts are not additive, and this table collapses dimensions '
  'by summing, so a summed unique count would be a confidently wrong number of '
  'exactly the kind the rest of this schema is built to prevent.';

create index ios_discovery_date_idx on ios_discovery_daily (app_id, date desc);

alter table ios_discovery_daily enable row level security;

-- Same shape as every other table: signed-in team members read, and every
-- write arrives through the cron routes on the service role key, which
-- bypasses RLS. No insert, update or delete policy, on purpose.
create policy "authenticated read" on ios_discovery_daily
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Housekeeping for the Google Play review collector
-- ---------------------------------------------------------------------------

-- reviews.country is NOT NULL and was written when only the App Store was
-- collected, where every review genuinely carries a storefront. Play exposes no
-- reviewer country at all; what it does expose is the language the review was
-- fetched under, so that is what Android rows store. Recording the language in
-- a column named country is a compromise, and this comment is the record of it,
-- so nobody later reads a Play row as geography.
comment on column reviews.country is
  'iOS: the storefront country polled. Android: the review language (uz, ru), '
  'because Google Play publishes no reviewer country. Read Android rows as '
  'language, never as location.';
