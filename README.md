# Ustoz AI store metrics

App Store and Google Play position, ratings, reviews and downloads for
[Ustoz AI](https://apps.apple.com/uz/app/ustoz-ai/id6504815934), in one place,
with a daily Telegram digest.

## What each store actually gives you

This shaped the whole design, so it is worth stating plainly.

| Metric | iOS | Android |
|---|---|---|
| Category chart position | public, no credentials | not publicly ranked |
| Rating and rating count | public, per storefront | public |
| Reviews | public, intermittent and capped near 200 | public |
| Keyword search position | public, close proxy | not tracked |
| **Downloads** | App Store Connect key (connected) | **public, exact cumulative count** |

Two consequences:

**No download number is ever live.** Apple exposes no real-time install counter
anywhere, not even inside App Store Connect's own interface. Sales and Trends
publishes a day behind; the Analytics reports carry a further one to two day
completeness lag. Play's number is a running total, not a daily figure. Every
download shown in this dashboard is dated to the day it describes.

**History starts at the first collector run.** None of these endpoints return
past values, and neither store publishes historical rank, so earlier days cannot
be backfilled by anyone. iOS downloads are the single exception: Apple serves
daily sales reports for exactly 365 days and returns `410 Gone` beyond that,
measured, not assumed. That year has been backfilled (8,557 rows,
2025-08-12 onward, 31,492 first-time downloads, 86% of them Uzbekistan).

Readings taken 11 August 2026, kept as a reference point: #21 in Education on
the UZ App Store (#22 iPad, outside the overall top 100), 4.69 from 1178 iOS
ratings, 4.76 from 10,288 Play ratings, 530,577 Play installs, and #1 / #2 / #4
for the search terms `ustoz`, `ta'lim`, `talim`.

## Where it lives

Production: https://ustozaidashboard.vercel.app
Wall display: https://ustozaidashboard.vercel.app/tv

Note the missing hyphens. `ustozai-dashboard.vercel.app` is a different,
unrelated Vite app that already owned that name, so do not confuse the two when
checking whether something is deployed.

Supabase project `ustozai-dashboard` (`pquqfnolwrqvxoqymuvs`).

## Setup

1. **Database.** Supabase project `ustozai-dashboard`
   (`pquqfnolwrqvxoqymuvs`), schema already applied from
   `supabase/migrations/0001_init.sql`.
2. **Environment.** Copy `.env.example` to `.env.local` and fill it in. Only the
   first three variables are required; everything else degrades cleanly and the
   UI says which panels are dormant and why.
3. **First reading.**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll
```

## Commands

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run test:live
```

`test:live` hits the real Apple and Play endpoints. It is the canary for the
undocumented feeds this depends on: run it before blaming the database for a
chart that stopped moving.

## Backfill

`GET /api/cron/backfill?days=N` walks back further than the daily run, tolerating
per-day errors and stopping cleanly when Apple returns `410 Gone` at the
retention edge. Run it locally rather than on Vercel: a full year takes about
seven minutes, well past the 300s function ceiling, and it writes to the same
database either way. It is idempotent, so it is also the tool for repairing a
gap after an outage.

A note for anyone extending the read layer: **PostgREST caps a response at 1000
rows silently**. Combined with an ascending sort that removes the *newest* data
first, which is how the downloads page once reported "latest day recorded,
21 Jul" while the database held rows through 10 Aug. `fetchAllPages` in
`src/lib/db/queries.ts` exists for this; use it for anything that can exceed a
thousand rows.

## Collection

`/api/cron/poll`: chart position, ratings, Play installs, and reviews. Reviews
are fetched here as well as in the daily run because Apple's reviews feed goes
down for hours at a time, and they are insert-only and deduplicated, so extra
attempts cost one request and cannot duplicate anything.

`/api/cron/daily`: keyword positions, review sync, iOS downloads, then the
digest. Runs in the morning because App Store Connect closes a day and
publishes it the next, so there is nothing new before then.

`/api/cron/pulse`: audience counts only, and only the ones that can change
between two consecutive reads. Telegram always; Instagram once a token exists,
never through the scrape, which is refused from datacenter addresses and would
be blocked harder for being asked more often. **YouTube is deliberately
excluded**, and not out of caution: YouTube rounds every subscriber count to
three significant figures, in its official Data API exactly as on the page, so
at 174K the value cannot move until the channel crosses 174,500 and every extra
read is guaranteed to return the same string.

Alone among the collectors, the pulse writes nothing to `collector_runs`.
Reporting every sixty seconds would bury every other source in the health panel
and add half a million rows a year, to answer a question the freshness of the
readings already answers. Its failure mode is the audience numbers ceasing to
advance, which is the signal the wall display was built around, and the hourly
poll still records real health for the same platforms.

All three require `Authorization: Bearer $CRON_SECRET`. Neither fails as a whole when
one source breaks: each collector records its own outcome in `collector_runs`,
and the dashboard shows a freshness badge from it. That table is not optional
bookkeeping. The iTunes RSS is undocumented and the Play parser depends on an
internal payload layout, so the realistic failure mode is silence, and a chart
that quietly stops updating looks exactly like a metric that stopped moving.

## Architecture notes

Collectors under `src/lib/collectors` are pure: fetch, validate, return typed
records. They never touch the database. Every write goes through
`src/lib/db/persist.ts`. That split is what lets each parser be tested against a
saved real payload with no network and no Supabase.

Two conventions run through the schema. A null rank means the poll succeeded and
the app was outside the feed; a failed poll writes no row at all, so the two are
never confused. And every row from one run shares an hour-truncated timestamp,
so re-running a cron hour corrects rows instead of duplicating them.

The Play parser validates hard and throws rather than returning nulls. Its index
paths into Play's bootstrap payload are an internal detail that will move
eventually, and a loud failure is far better than a plausible wrong number.

## Design

Dark by default on the app icon's own near-black slate navy. Colour is reserved
for data: the brand supplies no chromatic accent, and where blue means iOS and
orange means Android, a third decorative accent would compete with meaning.

Those two hues are slots 1 and 2 of a validated categorical palette, checked
against these exact surfaces: worst-pair colour-vision-deficiency separation
ΔE 26.8 dark and 24.7 light against a ≥8 target, normal-vision ΔE 31.8 and 33.6
against a ≥15 floor, both above 3:1 contrast. Changing either value means
re-running that validation.

Rank axes are inverted so #1 sits at the top. Drawn conventionally, a climb from
#24 to #21 slopes downward and reads as bad news.

## The wall display

`/tv` is built for a screen on a wall, so it breaks the rules the browsable
pages follow. It never scrolls (`h-dvh` plus `overflow-hidden`, with every size
a viewport-relative `clamp()` so 1080p and 4K both fill exactly) and it carries
no navigation.

Its theme follows the Tashkent clock rather than the viewer's preference: light
from 07:00 to 19:00 when the room is bright, dark after. The class is set on
the page itself, not inherited, so nobody toggling their own laptop can change
what is on the wall; `src/lib/tv-theme.ts` holds the boundary and its tests pin
it exactly, including the case that a UTC-thinking server would otherwise keep
the wall dark through the working morning. The switch is a one second colour
fade, because an instant flip at the edge of vision is distracting in a room
people are working in.

This is why `globals.css` defines a `.light` class alongside `.dark`. The light
values normally live on `:root`, which an inner element cannot re-assert, so
without it there would be no way to force light inside a dark document. It refreshes itself every five minutes and whenever the
screen becomes visible again, so a TV waking from sleep is never showing
yesterday.

Sign in once on that machine and the session lasts 30 days.

## Audience tracking

Three platforms, three very different levels of reliability, and the code says
so rather than pretending they are equivalent:

| Platform | Source | Fidelity | Reliability |
|---|---|---|---|
| Telegram | Bot API `getChatMemberCount` | exact | solid; a bot can read any public channel without joining |
| Instagram | the endpoint instagram.com itself calls | exact | **blocked from Vercel**, see below |
| YouTube | channel page bootstrap payload | rounded | good |

Platform logos are the real artwork from `public/logos/`, not tinted
silhouettes, because recognising a gradient Instagram mark from across a room
is faster than reading a label. They do not share an aspect ratio (YouTube
ships as a 1.43:1 tile, the others are square, and Instagram ships with no
`viewBox` at all) so each is centred and contained in a fixed square box to
give them equal optical weight. There are deliberately no logos beside the App
Store and Google Play figures: the labels already say which store, and App
Store blue sits next to the iOS chart line in nearly the same blue, which would
put a decorative colour where colour otherwise means a data series.

**YouTube rounds every subscriber count to three significant figures**, for its
own official API as much as for the page, so the scrape gives up no precision.
`is_exact` records this and the UI prints a leading `≈` rather than implying a
number YouTube will not state.

**The YouTube parser is anchored to the channel header on purpose.** A channel
page embeds other channels' counts in its recommendation shelves: a loose scan
of @UstozAI finds thirteen matches and the first is 53K, belonging to a
suggested channel, while the real figure is 174K. The fixture in the test suite
deliberately includes that decoy ahead of the real value.

**Instagram scraping does not work from Vercel.** Confirmed in production: 429
after three retries, while the identical request returns 200 from a residential
address. That is an IP reputation problem and no amount of retrying fixes it.

Two consequences are handled explicitly.

A 429 is recorded as `skipped`, not `failed`, via `RateLimitedError`. It is a
known limitation of the host rather than an incident, and a permanent red
warning on a wall display would teach a roomful of people to ignore warnings,
so the next real outage would go unnoticed. The staleness badge on the tile is
what carries the honest signal instead.

The real fix is the official **Instagram API with Instagram Login**, which works
from anywhere because it authenticates as the account. It supports Creator
accounts and needs no linked Facebook Page. Set `INSTAGRAM_ACCESS_TOKEN` once
and the collector prefers it automatically, keeping the scrape as a local
fallback.

### The Instagram token rotates, so it lives in the database

Long-lived tokens last 60 days and are refreshed by trading the old one for a
new one. **A token that misses that window expires permanently and can only be
replaced by a person signing in again.** A Vercel environment variable cannot
rewrite itself, so the credential lives in `integration_tokens` instead, seeded
once from the env var and rotated in place thereafter.

That table is the one place in this schema with RLS enabled and **no policy at
all**. Everything else grants `authenticated` read; this holds a live
credential, so only the service role can reach it. Verified by inserting a row
and confirming the publishable key reads nothing while the service role reads
it.

The daily run refreshes at 30 days remaining, leaving a month of slack for the
cron itself to be broken. Inside 14 days the digest starts printing an explicit
"Action needed" line, because past the deadline no automation can recover it.

## Access

One shared password for the team, set in `DASHBOARD_PASSWORD`. No email is
involved, which is the point: magic links depend on SMTP, and SMTP is the part
that breaks.

The tradeoff is accepted deliberately. There are no per-person accounts, so you
cannot tell who looked at what, and removing one person's access means changing
the password for everyone. For an internal metrics dashboard read by a handful
of colleagues that is a fair price for something that always works.

The cookie never holds the password. It carries an expiry and an HMAC over it,
keyed by a hash of the password, so a stolen cookie cannot be turned back into
the password, and **changing `DASHBOARD_PASSWORD` invalidates every session at
once**. That is how you sign everybody out.

The check runs twice on purpose. `src/proxy.ts` redirects signed-out visitors,
which is fast but optimistic; `src/app/load.ts` re-verifies on the server before
any page renders a figure, which is authoritative. Cron routes are exempt from
the redirect and authenticate with their bearer secret instead.

A wrong password costs a one second delay. That is the only brute-force defence:
real rate limiting needs shared state serverless functions do not have, so the
protection is the password being long. Supabase's built-in
email sender is rate limited; for a team of five that is fine, but wire up SMTP
if links start getting throttled.

## Deploying

Two schedulers, deliberately split, plus refreshing on demand during a render.

**The hourly poll and the five-minute pulse run from Postgres**, via `pg_cron`
and `pg_net`, defined in `0004_pg_cron_poll.sql` and `0005_audience_pulse.sql`.
Vercel Hobby caps each cron job at once per day, which left chart position
sampled once and gave Apple's intermittently empty reviews feed two chances a
day instead of eight. pg_cron has no such limit and needed no new service, repo
or paid plan. The bearer token lives in Supabase Vault rather than inline,
because `cron.job.command` is readable by anyone who can query it.

Hourly is as fine-grained as the store data itself: Apple recomputes its charts
a handful of times a day, publishes a download day in arrears, and moves a
1200-rating average in the third decimal. Faster would re-read identical values.

**Rendering a page fetches its own audience reading** when the stored one is
older than 55 seconds, in `src/lib/collectors/freshen.ts`. This is what makes
refreshing the browser mean something rather than redrawing whatever the last
scheduled run caught. Three properties keep it safe in a server component: it
is conditional, so most renders make no outbound call at all; it is bounded, so
a hanging platform cannot hold the page, and the write still lands afterwards
for the next render to pick up; and it never throws, because failing to
freshen must leave the page rendering exactly what it otherwise would.
Concurrent renders share one in-flight read, the same fix `resolveAppIds`
needed for the same reason.

The five-minute pulse is therefore mostly a floor, doing little on a day when
the wall display is on. It exists for the days it is off, so the week-over-week
comparison is built from an even sample rather than from whenever somebody
happened to open a browser.

Freshness needs two columns, which is worth understanding before touching
`social_snapshots`. `captured_at` is truncated to the hour and is the conflict
key, which is what keeps repolling from multiplying rows. That makes it useless
for "how old is this number": a reading taken at 12:59 is filed under 12:00 and
would look 59 minutes stale the instant it was written. `checked_at` records
when the platform was actually reached, is set explicitly on every write rather
than left to its column default (a default does not apply on conflict), and is
what the staleness badge and the wall's "live" indicator read.

The job calls the `ustozaidashboard.vercel.app` hostname on purpose, not a
custom domain, so it cannot break when domains are added or removed.

**The daily digest stays on Vercel** at 01:00 UTC and is not duplicated in
pg_cron. Re-running the poll is harmless because its writes are idempotent
upserts, but two schedulers firing the daily would send the team two Telegram
messages.

`pg_net` is fire and forget: the call returns immediately and the outcome lands
in `net._http_response`. That table is the only place a failed call is visible,
so when the wall goes stale, look there first:

```sql
select id, status_code, left(content, 200), error_msg, created
from net._http_response order by id desc limit 10;
```

## Not done yet

- iOS downloads. Needs the App Store Connect `.p8`; every panel that depends on
  it currently says so rather than showing a zero.
- Rotating the Supabase secret key and Telegram bot token, both of which were
  pasted into a chat transcript during setup.
- The Analytics reports pass: first-time versus redownload versus update, and
  traffic source. Apple generates nothing until an ongoing report is requested,
  and then only going forward, so that request should be made early.
