-- Google Play ranks share the App Store rank table.
--
-- No schema changes. Both of these are comments that were true when they were
-- written and stopped being true when the code around them moved, which is the
-- worst state for a comment to be in: a reader trusts it precisely because
-- somebody bothered to write it.

-- ---------------------------------------------------------------------------
-- chart_ranks now holds Google Play as well as the App Store
-- ---------------------------------------------------------------------------
--
-- Nothing about the table changes. Rows were always keyed by app_id, and the
-- apps table has always carried a platform, so an Android rank has always been
-- storable here. Until now nothing wrote one.
--
-- The consequence worth writing down is that chart_type and genre are read in
-- the context of whichever app the row points at. They are not shared
-- vocabularies across the two stores and were never meant to be compared
-- across them.

comment on column chart_ranks.chart_type is
  'topfree | topfreeipad | topgrossing | newapps for the App Store; topfree '
  'for Google Play. Read together with the app''s platform: the same string '
  'means a different chart on each store.';

comment on column chart_ranks.genre is
  'Apple genre id such as 6017 for Education, or Play''s category name such as '
  'EDUCATION, or the literal ''overall'' for the ungenred chart on either '
  'store. Which vocabulary applies is decided by the app''s platform, and the '
  'two never collide because a row belongs to exactly one app. A sentinel '
  'beats NULL here because NULL breaks unique matching.';
