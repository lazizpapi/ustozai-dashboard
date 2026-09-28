# The Jarvis read API

Jarvis is a voice assistant running on one laptop. It answers questions about
the company out loud, which means it needs the same figures the dashboard
shows, and it has no session cookie and no route to Supabase.

`/api/jarvis` is how it gets them. One tool per request, the same `runTool` the
dashboard chat and the nightly explainer already use, JSON out.

## Why it delegates rather than queries

Every derivation lives in `src/lib/db/queries.ts` and every tool mapping lives
in `src/lib/analyst/run-tool.ts`. A second implementation reading the tables
directly would drift from the first within a month, and the drift would show up
as Jarvis reading a different revenue figure aloud than the one on the screen —
the worst kind of bug to find, because both numbers look plausible.

So this endpoint is a thin shell over the existing switch. Adding a tool to the
chat adds it here for free.

## Authentication

Every request carries `Authorization: Bearer $JARVIS_SECRET`.

Generate one:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

It is a separate secret from `CRON_SECRET` and `INGEST_SECRET` on purpose: unlike
the others it lives on a laptop. On its own it only reads. Two switches, both
off unless set to `true`, widen it: `JARVIS_SESSIONS_ENABLED` lets it mint a
thirty-minute CEO session for Jarvis's browser, and `JARVIS_ACTIONS_ENABLED`
lets it post to the team's Telegram chat. Treat the key as worth whatever the
switches allow. Unset closes the endpoint rather than opening it, so a deploy
that forgets the variable is shut, not public.

`/api/jarvis` is listed in the proxy's machine-caller bypass. Without that, an
unauthenticated request would receive a 307 to `/login`, and a client following
the redirect would read a 200 with an HTML login page as success.

## Requests

`GET /api/jarvis` — the catalogue. Returns every readable tool with its name,
description and `parameters`, and the action tools with `enabled` set by
`JARVIS_ACTIONS_ENABLED`. Use it as a health check too: it proves the secret and
the deployment without running a query.

Jarvis builds its tools from this list when a call starts, so a tool added to
the dashboard chat reaches Jarvis on its next start with no change on that side.
`parameters` is plain JSON schema, never OpenAI's envelope: `type: "function"`
and `strict` are stripped, and a tool without arguments gets
`{"type": "object", "properties": {}}`. Gemini's schema type rejects unknown
keys, and one rejected declaration ends the whole voice session at connect, so
`handle.test.ts` pins both rules, plus text-only enums.

```json
{
  "ok": true,
  "tools": [
    {
      "name": "get_revenue",
      "description": "Money taken through the app, in som: ...",
      "parameters": { "type": "object", "properties": { "days": { "type": "number" } } }
    }
  ],
  "actions": { "enabled": false, "tools": ["send_telegram", "send_report"] }
}
```

`GET /api/jarvis/<tool>?days=7` — run one tool. Query values arrive as strings
and are converted back to numbers before clamping, so `?days=7` really means
seven days rather than falling back to the default of thirty.

`POST /api/jarvis/<tool>` with a JSON object body — the same thing, when a
query string is awkward. The body *is* the argument object; there is no
envelope.

## Sessions for Jarvis's browser

`POST /api/jarvis/session` returns a signed-in session so Jarvis can show
dashboard pages in its own browser:

```json
{ "ok": true, "cookie": { "name": "ustozai_session", "value": "...", "path": "/", "expiresAt": 1790000000000 } }
```

- **Off by default.** `501` until `JARVIS_SESSIONS_ENABLED=true`.
- **CEO, thirty minutes.** Signed by `issueSessionToken` exactly as the login
  page signs, so changing `DASHBOARD_PASSWORD` ends Jarvis's sessions too.
  Jarvis re-mints a few minutes before `expiresAt`.
- **Never seen by the model.** Jarvis's Python puts the cookie into the
  browser; the value never enters a tool result or the transcript.
- **Refused on `/ask`.** Jarvis's browser will not open the chat page, whose
  `remember_fact` tool writes. That rule lives on the Jarvis side.
- `503` when no CEO password is configured. `GET` answers `405`.
- A static route, so it wins over `/api/jarvis/[tool]`. No analyst tool may be
  called `session`, and `handle.test.ts` checks that.

## Responses

```json
{ "ok": true, "tool": "get_revenue", "args": { "days": 7 }, "data": { ... } }
```

`args` comes back **as used, not as asked for**. Arguments are clamped
(`days` to 1–365, `limit` to 1–100), and Jarvis says the period out loud, so
after a clamp it needs to know the query really ran over 365 days.

| Status | Meaning |
| --- | --- |
| 200 | Ran. `data` holds the tool's result. |
| 400 | No such tool. The body lists the valid names. |
| 401 | Missing, malformed or wrong bearer token — or `JARVIS_SECRET` is unset. |
| 405 | An action asked for with GET, or a session asked for with GET. |
| 422 | An action refused its input: no report yet, or message text empty or too long. |
| 500 | The query or action threw. `error` carries the message. |
| 501 | A switched-off feature: an action without `JARVIS_ACTIONS_ENABLED`, a session without `JARVIS_SESSIONS_ENABLED`. |
| 502 | Telegram did not take the message. Never reported as sent. |

A failing query answers 500 rather than 200 with an empty body, because Jarvis
would read an empty body aloud as "revenue is nothing", which is a different
sentence from "I cannot reach the dashboard".

## What it deliberately cannot do

**It cannot write.** The tool list handed to this endpoint is `ASK_TOOLS`, not
`CHAT_TOOLS`. The one tool that writes — `remember_fact`, which stores
something the user asked the chat to remember — is not in it, and a request for
it comes back 400.

**It sends only when switched on, and only on POST.** `send_telegram` and
`send_report` answer 501 ("real but unavailable") until
`JARVIS_ACTIONS_ENABLED=true`, with no code path below that 501, and
`handle.test.ts` checks it. Switched on, a GET still answers 405: a GET is what
a prefetching proxy or a pasted link sends.

- `POST /api/jarvis/send_report` posts the latest analyst report, formatted as
  the analyst formats it, and answers with `reportCreatedAt` so Jarvis can say
  how old it is. 422 when there is no report yet.
- `POST /api/jarvis/send_telegram` with `{"text": "..."}` posts up to 1000
  characters, HTML-escaped and labelled **Sent by Jarvis**, to the chat the
  daily digest uses. The length is checked after escaping, against Telegram's
  4096.

The confirmation lives on the Jarvis side, next to the microphone: the model
drafts, Jarvis reads the draft back, and its Python sends only after checking
that the next thing the person said was a yes. A misheard word must not be able
to post to the company channel.

## Checking a deployment

```
curl -H "Authorization: Bearer $JARVIS_SECRET" https://ustozaidashboard.vercel.app/api/jarvis
curl -H "Authorization: Bearer $JARVIS_SECRET" "https://ustozaidashboard.vercel.app/api/jarvis/get_revenue?days=7"
curl https://ustozaidashboard.vercel.app/api/jarvis            # expect 401
```

From the Jarvis side, `python -m jarvis.ustoz --check` does the same and also
compares the tool names it knows about against the catalogue.

## Where the code is

| File | Holds |
| --- | --- |
| `src/lib/jarvis/handle.ts` | Every decision: which tools, what happens on failure. Pure, dependencies injected. |
| `src/lib/jarvis/handle.test.ts` | The tests, which run without a database. |
| `src/app/api/jarvis/[tool]/route.ts` | Transport: a header, a query string, a status code. |
| `src/app/api/jarvis/route.ts` | The catalogue and health check. |
| `src/lib/jarvis/session.ts` | The session decision, signer injected. |
| `src/lib/jarvis/actions.ts` | What an action posts, and when it refuses. Deps injected. |
| `src/app/api/jarvis/session/route.ts` | Transport for the session. |
| `src/lib/cron-auth.ts` | `isAuthorizedBearer`, shared with cron and ingest. |
