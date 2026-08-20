# How competitor data is collected

A technical note for the IT department. Everything below is public store data
gathered from our own servers. No competitor system is accessed, no
credentials belonging to anyone else are used, and nothing here requires a
paid data provider.

## Short version

Five competitors are polled once an hour from four public endpoints. Apple
publishes ratings and chart positions without authentication; Google publishes
a cumulative install count on the public store page. Neither publishes
competitor download figures, so the dashboard derives a comparable rate from
the install counter and refuses to invent the rest.

## Who is tracked

Defined in `src/lib/collectors/config.ts` as `COMPETITORS`. Changing this list
is a code change and a deploy, deliberately: it is the one place that decides
what the whole market page means.

| Slug | App | iOS id | Android package |
|---|---|---|---|
| `intalim` | InTalim Students | 6504232456 | `uz.intalim` |
| `qizlar-akademiyasi` | Qizlar Akademiyasi | 6557054918 | `uz.globalmove.girls_academy` |
| `praktika` | Praktika AI Tutor | 1624701477 | `ai.praktika.android` |
| `ibrat-academy` | Ibrat Academy | 6447472950 | `uz.ibrat.farzandlari` |
| `englify` | Englify | 6499320034 | `uz.englify.englify_client_mobile` |

## The four sources

### 1. iTunes Lookup, for iOS rating and rating count

```
GET https://itunes.apple.com/lookup?id={iosId}&country=uz
```

Public, unauthenticated, JSON, one request per app. Returns
`averageUserRating`, `userRatingCount` and `version`.

Code: `src/lib/collectors/itunes-lookup.ts`

One safeguard worth naming. The parser writes the row against
`String(app.trackId ?? appId)`, falling back to the id that was requested and
never to ours. An earlier version fell back to our own id, so a response
missing `trackId` would have filed a competitor's rating onto the Ustoz AI row
and every panel downstream would have shown it without complaint.

### 2. iTunes RSS chart feed, for chart position

```
GET https://itunes.apple.com/uz/rss/topfreeapplications/limit=100/genre=6017/json
```

Public, unauthenticated. Genre 6017 is Education. **One request returns the
whole chart**, so positions for all five competitors plus ourselves cost a
single call rather than six. The top 30 entries are also stored as the visible
chart, which is where the "who is around us" table comes from.

Apple caps this feed at 100 entries whatever limit is requested. An app outside
the top 100 is recorded as `rank = null`, which the UI renders as "outside top
100" rather than as a missing reading. Those are different claims.

Code: `src/lib/collectors/itunes-charts.ts`

### 3. Google Play store page, for installs and Android rating

```
GET https://play.google.com/store/apps/details?id={package}&hl=en&gl=uz
```

Public HTML, no credentials. Google is the more generous of the two stores: it
publishes an exact cumulative install count that Apple has no equivalent for at
any tier.

The number is not in the page as text. It sits inside an `AF_initDataCallback`
block keyed `ds:5`, in a deeply nested positional array. Those positions are an
internal detail of Play's frontend and will move eventually, so the parser
validates hard and throws rather than returning nulls. A throw becomes a failed
row in `collector_runs` and a visible red badge on the Pipeline dashboard; a
silent null would look like a real zero.

If those positions start shifting often, the maintained alternative is the
`google-play-scraper` package, which tracks Play's layout changes upstream. We
already depend on it for review collection.

Code: `src/lib/collectors/play-details.ts`

### 4. Store listing metadata, for ASO changes

Taken from the same two responses above at no extra request. A content hash
over stable fields only (title, description, version, screenshots, icon) is
compared against the last stored version; a difference writes a new row. A
competitor editing their title or screenshots is an ASO experiment being run in
public, and this is how it becomes visible.

Ratings and install counts are deliberately excluded from that hash, so normal
daily drift can never masquerade as a listing change.

Code: `src/lib/collectors/listing.ts`

## Schedule and request volume

Scheduled by `pg_cron` inside Supabase, not by Vercel, because the Hobby plan
caps a Vercel cron at one run per day. Verified live:

| Job | Schedule |
|---|---|
| `poll-store-metrics` | `0 * * * *` (hourly) |
| `pulse-audience` | `*/5 * * * *` |
| `daily-analyst` | `40 1 * * *` |

pg_cron calls `/api/cron/poll` over `pg_net` with a bearer token
(`CRON_SECRET`) held in Supabase Vault.

Per hourly run, the competitor portion is **10 requests**: five iTunes Lookup
plus five Play pages. The chart feed is one request shared by everyone. That is
roughly 240 competitor requests a day across five apps and two stores, which is
well inside what either store serves to an ordinary browser.

## Request etiquette

- **Sequential, not parallel.** Five near-identical requests hitting one
  endpoint in the same instant is the shape that gets rate limited. The loop in
  `run-poll.ts` awaits each competitor in turn.
- **Ours are fetched first.** A slow or dead competitor listing can never delay
  our own numbers.
- **One failure is isolated.** Every call is wrapped in `step()`, so a dead
  listing produces one red badge on the Pipeline dashboard rather than a failed
  poll. The other four still record.
- **Timeout 15s, up to 3 attempts** with backoff (`src/lib/collectors/http.ts`).
- Play is sent a normal browser User-Agent, because it serves a different and
  much thinner payload to clients it does not recognise.

## Where it lands

| Table | Contents |
|---|---|
| `apps` | One row per app per platform, `role` distinguishing `own` from `competitor` |
| `metric_snapshots` | Rating, rating count, install count, per app per reading |
| `chart_ranks` | Chart position per tracked app per reading |
| `chart_apps` | The visible top 30 of the chart per day |
| `listing_versions` | One row per observed listing change |

All tables have row level security enabled with no anonymous policy. The only
route to this data is an authenticated request through the dashboard.

## What we deliberately do not claim

This is the part most worth passing on, because it is where a competitor
dashboard usually starts lying.

**Nobody outside Google can see a competitor's daily installs.** What is public
is a cumulative total that Google updates in batches every day or two. The
market page therefore shows installs per day as that total differenced over a
trailing week. Praktika's raw day-to-day differences over five days were
26,789, then 339, then 37,357, then 14,053, then zero: that describes Google's
publishing schedule, not Praktika's growth. The trailing average reads about
19,400 a day and is a real quantity over real days.

**Apple publishes no competitor download figures at any granularity.** Sensor
Tower and similar vendors sell estimates modelled from panel data we do not
have. Rather than invent one, the competitor profile shows **new ratings per
day** under its own name, with the assumption stated on the page: it tracks
demand only as far as the share of users who bother to rate stays steady. Read
as direction, not volume.

**Lifetime install totals are not comparable across apps of different ages.**
Praktika's 19.6 million against our half million measures how long they have
existed. That is why velocity sits to the left of the total in the table, so it
is the figure the eye lands on first.

**Movement columns name the span they actually measured.** Until seven days of
readings exist for an app, the comparison is against the oldest reading held
and the header says "over 4 days" rather than implying a week.

## Legal and ethical position

Worth stating plainly for anyone reviewing this:

- Every endpoint is public and unauthenticated, reachable from any browser.
- No competitor account, API key or private system is accessed.
- No personal data about competitors' users is collected. Reviews we store are
  our own app's only.
- Volume is modest, sequential and rate-limit-aware, roughly what a person
  refreshing a few store pages each hour would generate.
- Two of the sources are undocumented (the RSS feed and the Play page layout),
  so both can change without notice. That is a reliability risk rather than a
  legal one, and it is why both parsers fail loudly into the Pipeline
  dashboard.

## If IT wants to change something

- **Add or remove a competitor**: edit `COMPETITORS` in
  `src/lib/collectors/config.ts`, then deploy. Historic rows for a removed app
  stay in the database.
- **Change frequency**: `select cron.alter_job(...)` in Supabase, or edit the
  migration. Going below hourly is not useful: Play's counter only moves every
  day or two.
- **Watch health**: the Pipeline dashboard lists every collector by name with
  its last success, including one entry per competitor per store, for example
  `competitor:play:praktika`.
