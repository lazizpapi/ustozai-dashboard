-- What the assistant is allowed to remember between conversations.
--
-- Two tables, because two different things are being remembered and they have
-- nothing to do with each other.
--
-- agent_facts is taught memory: things somebody deliberately told the
-- assistant to keep. "Exam season starts in May." "We ship on Fridays." These
-- are the causes the dashboard cannot see, and without them every explanation
-- the assistant writes is limited to what the collectors happen to measure.
--
-- Explicit is the whole contract. Nothing lands in this table unless a person
-- typed a remember command or said yes to an offer to save. A model deciding
-- for itself what is worth keeping fills the table with misreadings nobody
-- reviewed, and a wrong fact does not sit there quietly: it is injected into
-- every future answer.
--
-- telegram_turns is conversation memory for the one surface that has nowhere
-- else to put it. The web chat holds its history in the browser and posts it
-- back each turn; Telegram has no browser, so every question arrived as turn
-- one and "and the week before?" could never work.

create table agent_facts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Verbatim what was asked to be kept. Capped because a fact is a sentence;
  -- anything longer is a document, and belongs somewhere it can be edited.
  fact       text not null check (char_length(fact) between 1 and 500),
  taught_via text not null check (taught_via in ('telegram', 'chat')),
  -- Soft delete. Forgetting has to stay auditable: a fact that silently
  -- vanished and a fact that was never taught look identical without this,
  -- and the first question after a wrong answer is what did we tell it.
  active     boolean not null default true
);

comment on table agent_facts is
  'Durable notes the team explicitly taught the assistant, injected as context '
  'into every model call. active=false means forgotten, kept for the audit.';

alter table agent_facts enable row level security;

create policy "authenticated read" on agent_facts
  for select to authenticated using (true);

create table telegram_turns (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  chat_id       text not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  -- Assistant rows only. This doubles as the usage log for the Telegram
  -- analyst, which is the one model path in the project that recorded what it
  -- spent nowhere at all. It is also why rows are never pruned: deleting the
  -- conversation would delete the record of what it cost.
  input_tokens  integer,
  output_tokens integer
);

comment on table telegram_turns is
  'Conversation history for the Telegram analyst, and its token usage log.';

create index telegram_turns_chat_recent_idx
  on telegram_turns (chat_id, created_at desc);

alter table telegram_turns enable row level security;

-- Deliberately no read policy. These turns carry whatever the analyst was
-- asked, answers about the company takings included, and every legitimate
-- reader of them is the service role. An authenticated-read policy here would
-- hand any department session the entire chat log.
