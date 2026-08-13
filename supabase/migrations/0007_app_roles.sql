-- Ours, and everybody else's.
--
-- The apps table was always keyed on (platform, store_id) so it could hold more
-- than one listing, and every collector already takes an app id. What was
-- missing is a way for a query to say "the app this dashboard is about" without
-- every read hardcoding a store id.
--
-- A column rather than comparing store ids in each query. The question "is this
-- row ours" then has exactly one answer, stored next to the row, and adding a
-- competitor cannot quietly change what an existing page means.

alter table apps add column role text not null default 'own'
  check (role in ('own', 'competitor'));

comment on column apps.role is
  'own = the Ustoz AI listing this dashboard reports on. competitor = a listing '
  'tracked only for market comparison: chart rank and store snapshots, never '
  'reviews, keywords, downloads or audience.';

-- The load-bearing part.
--
-- Every read that means "our app" resolves it with a single-row lookup per
-- platform. Inserting a second iOS row without this index would make that
-- lookup ambiguous and break every page at once, which is a failure that would
-- arrive with the seed data rather than with the code that caused it. The
-- constraint makes that impossible rather than merely unlikely.
create unique index apps_one_own_per_platform on apps (platform) where role = 'own';
