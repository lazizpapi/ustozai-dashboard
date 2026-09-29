# The Jarvis API

Jarvis is UstozAI's voice assistant. Anyone signed in to the dashboard can talk
to it at `/jarvis`, and it answers each department only within that
department's own pages. It needs the same figures the dashboard shows, and the
agent has no session cookie and no route to Supabase.

`/api/jarvis` is how it gets them. One tool per request, the same `runTool` the
dashboard chat and the nightly explainer already use, JSON out.

## Why it delegates rather than queries

Every derivation lives in `src/lib/db/queries.ts` and every tool mapping lives
in `src/lib/analyst/run-tool.ts`. A second implementation reading the tables
directly would drift from the first within a month, and the drift would show up
as Jarvis reading a different revenue figure aloud than the one on the screen:
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

`/api/jarvis` and everything under `/api/jarvis/` are in the proxy's
machine-caller bypass, matched by whole segment. Without that, an
unauthenticated request would receive a 307 to `/login`, and a client following
the redirect would read a 200 with an HTML login page as success.
`/api/jarvis-token` only shares the prefix: it serves a signed-in person and
takes the ordinary session check.

## Who is calling

Every request also carries `X-Jarvis-Role`: `ceo`, `marketing`, `product` or
`it`. The agent reads it from the caller's LiveKit token, which
`/api/jarvis-token` signs from their session cookie, so the browser cannot
change it. It is trusted here because only the agent holds `JARVIS_SECRET`.

- **No role, or an unknown one: 403.** Nothing falls back to the CEO.
- **A department gets what its own screens show** (`src/lib/jarvis/authority.ts`):
  marketing the funnel, keywords, listings, audience, growth, chart, market and
  metric notes; product downloads, reviews, listings, growth, audience and notes;
  IT collector health and the latest report. `get_revenue` is the CEO's alone,
  as `/business` is.
- **Queries run as the caller.** Metric notes are cut by `visibleKeys`, so a
  department never hears a revenue note.
- **A tool outside the role: 403** with the caller's own tools listed. An
  unknown name stays 400, also listing only the caller's tools.
- **Posting** takes a role named in `JARVIS_POSTING_ROLES` (the CEO when unset).
- **Browser sessions** are signed for the caller's department, so Jarvis can
  open only that department's pages.

## Requests

`GET /api/jarvis`: the catalogue for the caller. Returns the caller's readable
tools with their name, description and `parameters`, the action tools with
`enabled` (the switch, and the caller allowed to post), and `pages`, the
dashboard paths Jarvis may show them. Use it as a health check too: it proves
the secret and the deployment without running a query.

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
  "actions": { "enabled": false, "tools": ["send_telegram", "send_report"] },
  "pages": ["/", "/business", "/growth"]
}
```

`GET /api/jarvis/<tool>?days=7`: run one tool. Query values arrive as strings
and are converted back to numbers before clamping, so `?days=7` really means
seven days rather than falling back to the default of thirty.

`POST /api/jarvis/<tool>` with a JSON object body: the same thing, when a
query string is awkward. The body *is* the argument object; there is no
envelope.

## Sessions for Jarvis's browser

`POST /api/jarvis/session` returns a signed-in session so Jarvis can show
dashboard pages in its own browser:

```json
{ "ok": true, "cookie": { "name": "ustozai_session", "value": "...", "path": "/", "expiresAt": 1790000000000 } }
```

- **Off by default.** `501` until `JARVIS_SESSIONS_ENABLED=true`.
- **The caller's department, thirty minutes.** Signed by `issueSessionToken`
  exactly as the login page signs, under that department's password, so
  changing it ends Jarvis's sessions too. Jarvis re-mints a few minutes before
  `expiresAt`.
- **Never seen by the model.** Jarvis's Python puts the cookie into the
  browser; the value never enters a tool result or the transcript.
- **No chat.** The session is marked as Jarvis's inside its signature, and
  `/api/ask` refuses it with 403 (`mayUseChat` in `gate.ts`), because the chat's
  `remember_fact` tool writes. Jarvis's browser also blocks `/ask` and
  `/api/ask` on its own side, but the dashboard does not rely on that.
- `503` when the caller's department has no password configured. `GET`
  answers `405`.
- A static route, so it wins over `/api/jarvis/[tool]`. No analyst tool may be
  called `session`, and `handle.test.ts` checks that.

## Talking to Jarvis, and the call log

`/jarvis` is the voice screen, open to every department and installable on a
phone (`public/jarvis.webmanifest`). It asks `POST /api/jarvis-token` for a
LiveKit token: the session cookie says who is asking, the department goes into
the token as a signed participant attribute, the room admits the caller and
Jarvis only, and Jarvis's own browser session is refused. It needs
`LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (503 without them),
and `JARVIS_AGENT_NAME` when the agent registers under a name other than
`my-agent`.

When a call ends the agent posts `POST /api/jarvis/calls`: room, identity,
department, start, length, tools used, token usage, close reason and a summary
of at most 2000 characters. Every field is checked (`src/lib/jarvis/calls.ts`)
before it is stored in `jarvis_calls` (migration 0021). The CEO reads the log
on `/calls`; no department can. Like `session`, `calls` is a reserved name.

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
| 400 | No such tool. The body lists the caller's valid names. |
| 401 | Missing, malformed or wrong bearer token, or `JARVIS_SECRET` is unset. |
| 403 | No `X-Jarvis-Role`, or a tool, action or page outside the caller's department. |
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
`CHAT_TOOLS`. The one tool that writes, `remember_fact`, which stores
something the user asked the chat to remember, is not in it, and a request for
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
curl -H "Authorization: Bearer $JARVIS_SECRET" -H "X-Jarvis-Role: ceo" https://ustozaidashboard.vercel.app/api/jarvis
curl -H "Authorization: Bearer $JARVIS_SECRET" -H "X-Jarvis-Role: ceo" "https://ustozaidashboard.vercel.app/api/jarvis/get_revenue?days=7"
curl -H "Authorization: Bearer $JARVIS_SECRET" -H "X-Jarvis-Role: marketing" "https://ustozaidashboard.vercel.app/api/jarvis/get_revenue"   # expect 403
curl https://ustozaidashboard.vercel.app/api/jarvis            # expect 401
curl -X POST https://ustozaidashboard.vercel.app/api/jarvis-token   # expect 401
```

From the Jarvis side, `uv run python src/ustoz_client.py --check` does the
same, asking as the CEO.

## Where the code is

| File | Holds |
| --- | --- |
| `src/lib/jarvis/authority.ts` | Which tools, pages and actions each department gets. |
| `src/lib/jarvis/handle.ts` | Every decision: which tools, what happens on failure. Pure, dependencies injected. |
| `src/lib/jarvis/handle.test.ts` | The tests, which run without a database. |
| `src/app/api/jarvis/[tool]/route.ts` | Transport: a header, a query string, a status code. |
| `src/app/api/jarvis/route.ts` | The catalogue and health check. |
| `src/lib/jarvis/session.ts` | The session decision, signer injected. |
| `src/lib/jarvis/actions.ts` | What an action posts, and when it refuses. Deps injected. |
| `src/app/api/jarvis/session/route.ts` | Transport for the session. |
| `src/lib/jarvis/call-token.ts` | The call token: who, which room, which agent. |
| `src/app/api/jarvis-token/route.ts` | Transport for the call token, from the session cookie. |
| `src/lib/jarvis/calls.ts` | The call record's checks. |
| `src/app/api/jarvis/calls/route.ts` | Transport for the call record. |
| `src/app/jarvis/`, `src/components/jarvis/` | The voice screen. |
| `src/lib/cron-auth.ts` | `isAuthorizedBearer`, shared with cron and ingest. |
