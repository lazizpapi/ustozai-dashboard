-- One row per call with Jarvis, the voice assistant.
--
-- Once colleagues can talk to Jarvis, "who asked what, and when" is the only
-- way to notice a misuse, to answer "did Jarvis really say that", and to see
-- what the free LiveKit and Gemini plans are being spent on. The agent posts
-- this row when a call ends, through /api/jarvis/calls, which checks every
-- field first (src/lib/jarvis/calls.ts).
--
-- There are no per-person accounts, so "who" is the department whose password
-- signed the caller in, plus the random identity LiveKit gave the call.

create table jarvis_calls (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  room          text not null check (char_length(room) between 1 and 200),
  identity      text not null check (char_length(identity) between 1 and 200),
  role          text not null check (role in ('ceo', 'marketing', 'product', 'it')),
  caller_name   text not null default '' check (char_length(caller_name) <= 100),
  started_at    timestamptz not null,
  duration_s    integer not null check (duration_s between 0 and 86400),
  tools_used    text[] not null default '{}',
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  close_reason  text not null default '' check (char_length(close_reason) <= 64),
  summary       text not null default '' check (char_length(summary) <= 2000)
);

comment on table jarvis_calls is
  'One row per call with Jarvis: department, when, how long, tools used, token '
  'usage and a short summary. Written by the agent via /api/jarvis/calls.';

create index jarvis_calls_recent_idx on jarvis_calls (started_at desc);

alter table jarvis_calls enable row level security;

-- Deliberately no read policy, as with telegram_turns. A summary can carry an
-- answer about the company takings, and every legitimate reader is the
-- service role behind the CEO's /calls page.
