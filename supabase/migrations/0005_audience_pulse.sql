-- A fast lane for the numbers that actually move.
--
-- The three-hourly poll treats every source the same, which wastes effort on
-- some and starves others. The sources divide sharply:
--
--   Telegram   exact, live, one cheap documented API call. A 50k channel gains
--              a member every few minutes, so this is genuinely worth polling
--              at a human timescale.
--   Instagram  exact and live, but only through the official API. The scrape
--              is refused from datacenter addresses, and polling it harder
--              would earn a longer block, so it joins the fast lane only once
--              a token exists.
--   YouTube    rounded to three significant figures by YouTube itself, its own
--              Data API included. At 174K the figure cannot change until the
--              channel crosses 174,500. Polling it every minute is guaranteed
--              to return the same string, so it stays on the slow poll.
--
-- Everything else on the dashboard is bounded by the vendor, not by us. Apple
-- recomputes its charts a handful of times a day, closes a download day and
-- publishes it the next, and moves a 1263-rating average in the third decimal.
-- Those move to hourly, which is as fine-grained as the data itself.

-- ---------------------------------------------------------------------------
-- Freshness has to be recorded separately from the reading it belongs to.
-- ---------------------------------------------------------------------------
--
-- captured_at is truncated to the hour so that a rerun upserts instead of
-- duplicating, which is what keeps the table small enough to chart. That is
-- exactly wrong for answering "how old is this number": a reading taken at
-- 12:59 is stamped 12:00 and looks 59 minutes stale the moment it is written.
--
-- Two columns because they answer two questions. captured_at is which hour the
-- reading belongs to, and stays the key. checked_at is when we last actually
-- reached the platform, and is what the staleness badge reads.

alter table social_snapshots add column if not exists checked_at timestamptz;

-- Backfill before defaulting. Adding the column with default now() would have
-- claimed every historical row was read this instant, which is the one value
-- guaranteed to be wrong for all of them.
update social_snapshots set checked_at = captured_at where checked_at is null;

alter table social_snapshots alter column checked_at set default now();
alter table social_snapshots alter column checked_at set not null;

comment on column social_snapshots.checked_at is
  'When the platform was last successfully reached for this row. Unlike '
  'captured_at it is not truncated, because the staleness badge needs real '
  'elapsed time. Repolling within the same hour updates this in place.';

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
--
-- cron.schedule upserts on the job name, so re-running this migration
-- reschedules rather than duplicating.

-- Hourly, up from three-hourly. One row per hour matches the hour bucket
-- exactly, so nothing is written and immediately overwritten, and chart
-- position now follows Apple within the hour it recomputes.
select cron.schedule(
  'poll-store-metrics',
  '0 * * * *',
  $job$
  select net.http_get(
    url := 'https://ustozaidashboard.vercel.app/api/cron/poll',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')
    ),
    timeout_milliseconds := 150000
  );
  $job$
);

-- The floor under the audience counts. Page loads trigger a read of their own
-- when the stored one is stale, so on a day when the wall display is on this
-- job does almost nothing. It exists for the days it is off: without it the
-- week-over-week comparison would be built from whenever somebody happened to
-- open a browser.
select cron.schedule(
  'pulse-audience',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := 'https://ustozaidashboard.vercel.app/api/cron/pulse',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')
    ),
    -- Two API calls at most. A pulse that cannot finish in fifteen seconds has
    -- already missed its purpose and the next one is five minutes away.
    timeout_milliseconds := 15000
  );
  $job$
);
