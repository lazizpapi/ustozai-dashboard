# Sending active users to the dashboard

The dashboard cannot work out DAU, WAU or MAU on its own. Apple only counts
users who opted into sharing analytics, and Google publishes nothing
comparable, so the app's own backend is the only place that can count every
user on both platforms. This is the one endpoint on the dashboard that accepts
numbers instead of collecting them.

One request a day is all it needs.

## The endpoint

```
POST https://metrics.ustoz.ai/api/ingest/active-users
Authorization: Bearer <INGEST_SECRET>
Content-Type: application/json
```

Until the custom domain resolves, use
`https://ustozaidashboard.vercel.app/api/ingest/active-users`.

Ask for `INGEST_SECRET` from whoever runs the Vercel project. It is not the
same as the dashboard password, and it grants nothing except writing these
counts.

## The body

```json
{
  "date": "2026-08-16",
  "dau": 1200,
  "wau": 5400,
  "mau": 14000
}
```

- `date` is the Tashkent calendar day the counts describe, exactly
  `YYYY-MM-DD`. Send yesterday's figures once the day has closed.
- `dau`, `wau`, `mau` are whole non-negative numbers: unique users active in
  the last 1, 7 and 30 days.
- `platform` is optional and defaults to `"all"`. If you also want a
  breakdown, send extra rows with `"ios"`, `"android"` or `"web"`; the
  dashboard headline always uses `"all"`, so a breakdown never double-counts.

Send an array to backfill history in one request:

```json
[
  { "date": "2026-08-15", "dau": 1150, "wau": 5300, "mau": 13800 },
  { "date": "2026-08-16", "dau": 1200, "wau": 5400, "mau": 14000 }
]
```

Re-sending a date overwrites it, so a retry is safe and a restatement is just
another push.

## What gets rejected, and why

The endpoint is strict on purpose: a wrong DAU does not break anything
visibly, it just becomes the number people quote in meetings.

| Response | Meaning |
|---|---|
| `401` | Missing or wrong bearer token. Identical response when the secret is unset on the server, so this alone does not tell you which. |
| `400` | The body was wrong. The message names the field and the date, for example `invalid row for 2026-08-15: dau (9000) cannot exceed wau (5400)`. |
| `500` | Reached us and failed to store. Safe to retry. |
| `200` | Stored. Returns `{ok: true, stored: N, dates: [...]}`. |

Specifically rejected:

- `dau > wau` or `wau > mau`. Somebody active today is active this week, so
  this is always a bug on the sending side.
- Numbers as strings (`"1200"`), fractions, or negatives.
- A missing field. Nothing defaults to zero, because zero is a claim that
  nobody opened the app.
- Dates that are not real (`2026-02-31`), not `YYYY-MM-DD`, or in the future
  in Tashkent terms.

## Checking your wiring

A `GET` to the same URL with the same token returns `{ok: true}`. That
separates "wrong secret" from "wrong URL" before you send real data.

```bash
curl -s -H "Authorization: Bearer $INGEST_SECRET" \
  https://ustozaidashboard.vercel.app/api/ingest/active-users
```

Then one real day:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-16","dau":1200,"wau":5400,"mau":14000}' \
  https://ustozaidashboard.vercel.app/api/ingest/active-users
```

## A daily job

Any scheduler works. Whatever you use, compute the counts for the day that
just closed in Asia/Tashkent, not in UTC, or the figures will be filed a day
early roughly a fifth of the time.

Node, run once a day after midnight Tashkent:

```js
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(Date.now() - 86_400_000));

const counts = await activeUserCounts(day); // your query

const response = await fetch(
  "https://ustozaidashboard.vercel.app/api/ingest/active-users",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INGEST_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ date: day, ...counts }),
  },
);

if (!response.ok) {
  // Log the body: a 400 says exactly which field was wrong.
  throw new Error(`active-users push failed: ${await response.text()}`);
}
```

Do log the failure body somewhere you will read. If the push stops, nothing on
the dashboard breaks; the figures just stop moving. The dashboard notices that
and says "no push for N days" beside them, but only the backend's own logs can
say why.
