-- The frequent poll is scheduled by Postgres, not by Vercel.
--
-- Vercel Hobby allows each cron job to run at most once per day. That left
-- chart position sampled once at 11:00 UTC, so any movement within a day was
-- invisible, and it gave Apple's intermittently empty reviews feed only two
-- chances a day to be reachable instead of eight.
--
-- pg_cron has no such limit and needs nothing new: no extra service, no
-- separate repository to host a workflow, no paid plan.
--
-- The daily job deliberately stays on Vercel and is not duplicated here. It
-- sends the Telegram digest, and that is the one job where two schedulers both
-- firing would be visible to the whole team as a duplicate message.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The bearer token lives in Vault rather than inline in the job body, because
-- pg_cron.job is readable by anyone who can query it and the command column
-- would otherwise contain the secret in clear text.
--
-- Run once, by hand, with the real value:
--
--   select vault.create_secret(
--     '<CRON_SECRET>',
--     'dashboard_cron_secret',
--     'Bearer token the scheduled poll sends to /api/cron/*'
--   );

select cron.schedule(
  'poll-store-metrics',
  '0 */3 * * *',
  $job$
  select net.http_get(
    -- Deliberately the vercel.app alias rather than a custom domain. That
    -- hostname keeps working whatever domains are added or removed later, so
    -- the scheduler can never break because of a DNS change.
    url := 'https://ustozaidashboard.vercel.app/api/cron/poll',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dashboard_cron_secret')
    ),
    -- The poll walks several Apple feeds plus Play, so it needs room.
    timeout_milliseconds := 150000
  );
  $job$
);

-- pg_net is fire and forget: the call returns a request id immediately and the
-- outcome lands later in net._http_response. That table is the only place a
-- failed call is visible, so it is where to look when the dashboard goes stale:
--
--   select id, status_code, left(content, 200), error_msg, created
--   from net._http_response order by id desc limit 10;
