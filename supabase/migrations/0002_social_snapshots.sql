-- Audience size across Telegram, Instagram and YouTube.
--
-- Same conventions as 0001: one row per platform per hour-bucketed run, upsert
-- on the unique key so a rerun corrects rather than duplicates, RLS on with
-- read for authenticated only and writes through the service role.
--
-- The one addition is is_exact. Telegram and Instagram report a precise
-- integer; YouTube rounds every subscriber count to three significant figures
-- for everyone, its own official API included. Recording which is which lets
-- the UI print an honest "approximately" rather than implying a precision
-- YouTube does not publish.

create table social_snapshots (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in ('telegram', 'instagram', 'youtube')),
  handle       text not null,
  followers    bigint not null check (followers >= 0),
  is_exact     boolean not null default true,
  captured_at  timestamptz not null,
  unique (platform, captured_at)
);

comment on column social_snapshots.followers is
  'Channel members for Telegram, followers for Instagram, subscribers for '
  'YouTube. Different nouns, same question: how many people follow us.';
comment on column social_snapshots.is_exact is
  'False when the platform itself rounds. YouTube always rounds to three '
  'significant figures, so 174000 there means "about 174 thousand".';

create index social_snapshots_platform_time_idx
  on social_snapshots (platform, captured_at desc);

alter table social_snapshots enable row level security;

create policy "authenticated read" on social_snapshots
  for select to authenticated using (true);
