-- The apps we compare against.
--
-- Mirrors COMPETITORS in src/lib/collectors/config.ts, which carries the note
-- on why these five and where each stood on 2026-08-13. If the two drift, the
-- poll says so on the next run: persist throws "no apps row for <platform>:<id>"
-- rather than quietly skipping the app.
--
-- Apply this AFTER the code that scopes our own reads by role is deployed.
-- Between the two, a second iOS row would make "our app" ambiguous.
--
-- Re-runnable on purpose. Amending the list is an edit here plus an edit in
-- config, and running it again reconciles rather than duplicating.

insert into apps (platform, store_id, name, genre, role) values
  ('ios',     '6504232456',                      'InTalim Students',   'Education', 'competitor'),
  ('android', 'uz.intalim',                      'InTalim Students',   'Education', 'competitor'),
  ('ios',     '6557054918',                      'Qizlar Akademiyasi', 'Education', 'competitor'),
  ('android', 'uz.globalmove.girls_academy',     'Qizlar Akademiyasi', 'Education', 'competitor'),
  ('ios',     '1624701477',                      'Praktika AI Tutor',  'Education', 'competitor'),
  ('android', 'ai.praktika.android',             'Praktika AI Tutor',  'Education', 'competitor'),
  ('ios',     '6447472950',                      'Ibrat Academy',      'Education', 'competitor'),
  ('android', 'uz.ibrat.farzandlari',            'Ibrat Academy',      'Education', 'competitor'),
  ('ios',     '6499320034',                      'Englify',            'Education', 'competitor'),
  ('android', 'uz.englify.englify_client_mobile','Englify',            'Education', 'competitor')
on conflict (platform, store_id) do update
  set role = excluded.role,
      name = excluded.name,
      genre = excluded.genre;
