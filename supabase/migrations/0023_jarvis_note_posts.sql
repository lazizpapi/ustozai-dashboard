-- Reminders posted to the team's Telegram group on the day they fall due.
--
-- The hourly poll's 9:00 run (Tashkent) posts each department's due reminders,
-- one message per department with a "Bajarildi" button under each; the CEO's
-- are never posted (src/lib/jarvis/reminder-posts.ts). These columns are what
-- that needs:
--
--   last_posted_on  the Tashkent day it was last posted. A run claims each
--                   reminder for the day before sending, so a rerun of the
--                   poll, or two at once, never posts it twice.
--   post_count      how many mornings it has gone out. One nobody clears is
--                   posted on three mornings at most.
--   cleared_by      who ticked it off with the button, shown in the message.
--                   Null when it was cleared on a call with Jarvis.

alter table jarvis_notes
  add column last_posted_on date,
  add column post_count smallint not null default 0 check (post_count >= 0),
  add column cleared_by text check (char_length(cleared_by) between 1 and 100);
