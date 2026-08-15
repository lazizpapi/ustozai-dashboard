-- Store search suggestions: what each store's search box offers when someone
-- types one of our tracked terms. A suggestion is search demand the store has
-- itself observed, which makes a new one appearing under a seed we rank for
-- the cheapest early signal of demand shifting.
--
-- One row per suggested term per crawl day, upserted on the primary key so a
-- re-run of the daily corrects the day rather than duplicating it. History is
-- kept forever: the interesting query is "when did this term first appear",
-- which needs the old crawls to answer.

create table keyword_suggestions (
  platform     text not null check (platform in ('ios', 'android')),
  -- The tracked keyword the suggestions were requested for. The sentinel
  -- '__trending__' (ios only) holds the storefront's trending searches, which
  -- arrive from a sibling endpoint with no seed of their own. Verified live
  -- 2026-08-15: the endpoint answers for UZ but the list is still empty, so
  -- trending rows appear whenever Apple populates the storefront.
  seed         text not null,
  date         date not null,
  position     integer not null check (position >= 1),
  term         text not null,
  captured_at  timestamptz not null,
  primary key (platform, seed, date, position)
);

comment on table keyword_suggestions is
  'Search-suggest results per tracked seed keyword per day. iOS rows come from '
  'the MZSearchHints storefront endpoint, Android rows from the Play suggest '
  'RPC via google-play-scraper. Both are unofficial but long-stable; a failed '
  'crawl is a failed collector_runs row, never silent.';

create index keyword_suggestions_seed_idx
  on keyword_suggestions (platform, seed, date desc);

alter table keyword_suggestions enable row level security;

create policy "authenticated read" on keyword_suggestions
  for select to authenticated using (true);
