-- Instagram beyond the follower count.
--
-- Until now the whole of Instagram was one number: social_snapshots holds a
-- follower count and nothing else. The account publishes far more than that
-- through the same credential we already hold, and none of it was being kept.
--
-- Five different shapes of thing live here, in separate tables because they
-- answer different questions and expire on different clocks:
--
--   instagram_daily         how the account performed on a given day
--   instagram_posts         every post, with its settled lifetime totals
--   instagram_post_metrics  how a recent post's totals climbed, day by day
--   instagram_demographics  who the followers are
--   instagram_stories       stories, which vanish from the API after 24 hours
--
-- Two properties of the source shape all of it. Only reach and follower_count
-- can be read as a daily series; every other metric is an aggregate over a
-- window, so a daily figure costs one request per day. And stories are gone
-- within a day of posting, so anything not collected in that window is lost
-- permanently rather than merely late.

-- ---------------------------------------------------------------------------
-- instagram_daily: the account's own performance, one row per day
-- ---------------------------------------------------------------------------
--
-- Every metric column is nullable, and deliberately so. reach and new_followers
-- can be backfilled two years; the rest can only be gathered one request per
-- day and are therefore filled in from whenever collection started. A null
-- says "not collected for that day", which is true. A zero would say the
-- account reached nobody, which is not.

create table instagram_daily (
  date               date primary key,
  -- Unique accounts that saw any content. The only account metric besides
  -- new_followers that the API will serve as a daily series.
  reach              integer check (reach >= 0),
  -- Impressions, in the modern naming. Not a series: summed per day.
  views              integer check (views >= 0),
  accounts_engaged   integer check (accounts_engaged >= 0),
  total_interactions integer check (total_interactions >= 0),
  likes              integer check (likes >= 0),
  comments           integer check (comments >= 0),
  shares             integer check (shares >= 0),
  saves              integer check (saves >= 0),
  replies            integer check (replies >= 0),
  profile_views      integer check (profile_views >= 0),
  website_clicks     integer check (website_clicks >= 0),
  new_followers      integer check (new_followers >= 0),
  collected_at       timestamptz not null default now()
);

comment on table instagram_daily is
  'Daily account performance from the Instagram Graph API. Columns are '
  'nullable because reach and new_followers backfill two years while every '
  'other metric costs one request per day and only exists from the day '
  'collection started. Null means not collected, never zero.';

comment on column instagram_daily.new_followers is
  'Gross new follows for the day, not net. The API''s follower_count metric '
  'never goes negative even while the account is losing followers, so this '
  'cannot be differenced to get growth. social_snapshots holds the total.';

comment on column instagram_daily.views is
  'What the API used to call impressions. Renamed by Meta, not redefined.';

comment on column instagram_daily.reach is
  'Accounts reached that day, deduplicated within the day. NOT additive: '
  'summing the seven days to 2026-08-21 gives 398,428 while Instagram reports '
  '363,410 for the same window, an overstatement of ten percent, because a '
  'person reached on two days is one account over the week and two over the '
  'days. A weekly or monthly reach figure must be read from the API for that '
  'window, never summed from these rows. Same rule as any unique count.';

comment on column instagram_daily.accounts_engaged is
  'Deduplicated per window exactly like reach, and equally unsafe to sum.';

create index instagram_daily_recent_idx on instagram_daily (date desc);

alter table instagram_daily enable row level security;

create policy "authenticated read" on instagram_daily
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- instagram_posts: one row per post, holding its latest known totals
-- ---------------------------------------------------------------------------
--
-- Post insights are lifetime counters that only ever climb, so this table is
-- last-known-value rather than a time series: the row is overwritten on each
-- collection and ends up holding the settled total once the post stops moving.
--
-- The reels columns are null for feed posts and vice versa. That is the source
-- talking, not missing data: the Media Insights API rejects profile_visits and
-- follows for reels with a 400, and offers watch time only for reels.

create table instagram_posts (
  media_id            text primary key,
  posted_at           timestamptz not null,
  -- FEED or REELS. Decides which metrics exist at all.
  media_product_type  text not null,
  -- IMAGE, VIDEO or CAROUSEL_ALBUM.
  media_type          text not null,
  permalink           text,
  caption             text,
  reach               integer check (reach >= 0),
  views               integer check (views >= 0),
  likes               integer check (likes >= 0),
  comments            integer check (comments >= 0),
  shares              integer check (shares >= 0),
  saved               integer check (saved >= 0),
  total_interactions  integer check (total_interactions >= 0),
  -- Feed only.
  profile_visits      integer check (profile_visits >= 0),
  follows             integer check (follows >= 0),
  -- Reels only. Milliseconds, as reported.
  avg_watch_time_ms   bigint check (avg_watch_time_ms >= 0),
  total_watch_time_ms bigint check (total_watch_time_ms >= 0),
  collected_at        timestamptz not null default now()
);

comment on table instagram_posts is
  'Every post the account has published, with its most recent lifetime '
  'totals. Overwritten on each collection rather than versioned; '
  'instagram_post_metrics carries the day-by-day climb for recent posts.';

comment on column instagram_posts.profile_visits is
  'Feed posts only. The API returns a 400 for this metric on reels, so null '
  'here means the metric does not exist for this post, not that it was zero.';

comment on column instagram_posts.avg_watch_time_ms is
  'Reels only, in milliseconds as reported. Null for feed posts.';

create index instagram_posts_recent_idx on instagram_posts (posted_at desc);
create index instagram_posts_reach_idx on instagram_posts (reach desc nulls last);

alter table instagram_posts enable row level security;

create policy "authenticated read" on instagram_posts
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- instagram_post_metrics: how a recent post's totals climbed
-- ---------------------------------------------------------------------------
--
-- Written only for posts younger than thirty days. The counters plateau
-- quickly, and snapshotting every post every day would add roughly a hundred
-- and ninety thousand rows a year to answer questions about posts from 2023
-- that nobody asks. Thirty days is the window in which the curve is still
-- moving and therefore still interesting.

create table instagram_post_metrics (
  media_id           text not null references instagram_posts (media_id) on delete cascade,
  date               date not null,
  reach              integer check (reach >= 0),
  views              integer check (views >= 0),
  likes              integer check (likes >= 0),
  comments           integer check (comments >= 0),
  shares             integer check (shares >= 0),
  saved              integer check (saved >= 0),
  total_interactions integer check (total_interactions >= 0),
  collected_at       timestamptz not null default now(),
  primary key (media_id, date)
);

comment on table instagram_post_metrics is
  'Daily snapshots of a post''s cumulative counters, kept only while the post '
  'is under thirty days old. Values are running totals, not per-day deltas: '
  'difference two rows to get a day''s movement.';

create index instagram_post_metrics_recent_idx on instagram_post_metrics (date desc);

alter table instagram_post_metrics enable row level security;

create policy "authenticated read" on instagram_post_metrics
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- instagram_demographics: who the followers are
-- ---------------------------------------------------------------------------
--
-- The API serves these as lifetime totals with no history whatsoever, so the
-- daily row is the only way a trend ever comes to exist. Captured once a day;
-- the shape of the audience does not move faster than that.

create table instagram_demographics (
  date         date not null,
  -- Which cut of the audience this row belongs to.
  breakdown    text not null check (breakdown in ('country', 'city', 'age', 'gender')),
  -- The bucket within that cut: 'UZ', 'Tashkent, Tashkent Region', '25-34', 'F'.
  bucket       text not null,
  followers    integer not null check (followers >= 0),
  collected_at timestamptz not null default now(),
  primary key (date, breakdown, bucket)
);

comment on table instagram_demographics is
  'Follower counts by country, city, age band and gender. The API reports '
  'lifetime totals only, so history exists solely because we snapshot it '
  'daily. Buckets are stored exactly as the API spells them.';

comment on column instagram_demographics.bucket is
  'Verbatim from the API. Gender is M, F or U, where U is undeclared rather '
  'than a third category.';

create index instagram_demographics_recent_idx on instagram_demographics (date desc);

alter table instagram_demographics enable row level security;

create policy "authenticated read" on instagram_demographics
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- instagram_stories: the only data here that cannot be recovered
-- ---------------------------------------------------------------------------
--
-- Stories leave the API twenty-four hours after posting. Everything else in
-- this migration can be backfilled if a collector breaks; this cannot. The
-- hourly poll writes each story it can still see, so the row ends up holding
-- the last reading taken before the story expired.

create table instagram_stories (
  media_id           text primary key,
  posted_at          timestamptz not null,
  media_type         text not null,
  permalink          text,
  reach              integer check (reach >= 0),
  views              integer check (views >= 0),
  replies            integer check (replies >= 0),
  shares             integer check (shares >= 0),
  total_interactions integer check (total_interactions >= 0),
  -- Taps forward, back, out and to the next story, summed.
  navigation         integer check (navigation >= 0),
  collected_at       timestamptz not null default now()
);

comment on table instagram_stories is
  'Stories and their insights, captured hourly while they are still live. '
  'Figures are whatever the last successful read before expiry saw, so a '
  'story collected at hour 23 is more complete than one collected at hour 1. '
  'Nothing here can be backfilled: the API forgets stories after 24 hours.';

create index instagram_stories_recent_idx on instagram_stories (posted_at desc);

alter table instagram_stories enable row level security;

create policy "authenticated read" on instagram_stories
  for select to authenticated using (true);
