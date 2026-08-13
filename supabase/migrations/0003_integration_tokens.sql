-- Rotating third-party credentials.
--
-- This table exists because of one property of Instagram's long-lived tokens:
-- they last 60 days, they are refreshed by exchanging the old one for a new
-- one, and a token that misses that window expires permanently and can only be
-- replaced by a human signing in again. A Vercel environment variable cannot
-- rewrite itself, so a credential that rotates cannot live in one.
--
-- Note the deliberate difference from every other table in this schema.
-- 0001 and 0002 hold metrics and grant `authenticated` read. This one holds a
-- live credential, so row level security is enabled with NO policy at all:
-- only the service role, which bypasses RLS, can read or write it. An
-- authenticated dashboard user has no route to this value.

create table integration_tokens (
  provider     text primary key check (provider in ('instagram')),
  access_token text not null,
  expires_at   timestamptz not null,
  refreshed_at timestamptz not null default now()
);

comment on table integration_tokens is
  'Rotating API credentials. Service role only: RLS is on with no policy.';
comment on column integration_tokens.expires_at is
  'Hard deadline. Past this the token cannot be refreshed and the integration '
  'needs manual reauthorisation, so the refresh job runs well ahead of it.';

alter table integration_tokens enable row level security;
