-- Schedule the daily analyst.
--
-- On pg_cron rather than as a second Vercel cron entry, for two reasons: the
-- Hobby plan's cron allowance is small enough that adding one would compete
-- with the daily collection, and pg_cron already runs the poll and the pulse,
-- so this keeps one scheduler to check rather than two.
--
-- 01:40 UTC, forty minutes after the daily collector at 01:00. The daily run
-- takes well under a minute, so the gap is slack rather than a race: the
-- analyst reads a day that has been closed and written, not one being
-- collected underneath it.
--
-- cron.schedule upserts on the job name, so re-running this is a reschedule
-- rather than a duplicate.

select cron.schedule(
  'daily-analyst',
  '40 1 * * *',
  $job$
  select net.http_get(
    url := 'https://ustozaidashboard.vercel.app/api/cron/analyst',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')
    ),
    -- Generous: one model call on a thinking model can legitimately take
    -- minutes, and a timeout here would leave a failed row for a run that
    -- actually succeeded.
    timeout_milliseconds := 290000
  );
  $job$
);
