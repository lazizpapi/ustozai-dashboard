-- app_engagement_daily really is daily now.
--
-- No schema change. Two column comments that were written to describe a daily
-- figure, against a column that had quietly stopped holding one.
--
-- /statistics/visit-summary returns one aggregate for whatever date range it is
-- given, not a value per day. The collector used to hand it the backfill window
-- and write the answer to the last date in it, so a row said "this day" while
-- holding an average over the preceding week. A backfill made it worse rather
-- than better: `backfill-ustoz?days=250` stamped a two-hundred-and-fifty-day
-- average onto today.
--
-- Reported as a session length of 29.4 minutes against a true daily figure
-- nearer 8, with a login count beside it that was a week's worth sitting next
-- to a daily-active count. The collector now asks this endpoint for a single
-- day and leaves the wide window to the endpoints that return a series.
--
-- Rows written before 2026-08-24 still hold trailing-window values. They are
-- left alone deliberately: correcting them costs one request per day and
-- nobody reads a session average from March.

comment on column app_engagement_daily.average_minutes is
  'Average session length for this one day, from /statistics/visit-summary '
  'asked for a single-day range. That endpoint answers for whatever window it '
  'is given, so anything wider silently becomes an average across the window. '
  'Rows before 2026-08-24 predate the fix and hold a trailing-window figure.';

comment on column app_engagement_daily.total_logins is
  'Logins on this one day, from the same single-day call as average_minutes '
  'and subject to the same history. It sits beside a daily-active count in the '
  'UI, so a windowed total here makes the two impossible to reconcile.';
