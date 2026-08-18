-- Schema for the icon gallery's store: the review queue, per-guest history, and
-- the visit counters. Apply it once, in the Supabase SQL editor or with
-- `supabase db push`.
--
-- Two tables carry personal data under the DPDP Act 2023 — `submissions` and
-- `history` hold a pseudonymous guest id and a self-chosen public display name,
-- and `visit_guests` holds the guest id alone. The project must stay in
-- ap-south-1 (Mumbai) for that reason. Nothing here sets a retention window:
-- deciding one is the remaining task, and the cleanup query at the end of this
-- file is where it goes.
--
-- What is NOT stored here: the icon catalogue. Built icons live in git and are
-- served from docs/icons.json, and a contributed icon is derived from its
-- approved submission row, so there is no second copy of any drawing to drift.

-- --- Review queue ------------------------------------------------------------
create table if not exists submissions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  paths        jsonb not null check (jsonb_typeof(paths) = 'array'),
  prompt       text not null default '',
  summary      text not null default '',
  source       text not null default 'unknown',
  -- Public credit, capped at 20 characters by the API. "Anonymous" when unnamed.
  contributor  text not null default 'Anonymous',
  -- name + summary identity for the one-submission-per-icon rule. Unique here
  -- rather than checked in the application: two concurrent requests can both
  -- pass a read-then-write test, and only the database can settle that race.
  dedupe_key   text not null unique,
  -- The submitter, as the opaque id from their signed cookie. Not an account.
  guest_id     text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  text,
  note         text
);

-- The queue is read newest-first, filtered by status.
create index if not exists submissions_status_created_idx on submissions (status, created_at desc);
create index if not exists submissions_guest_idx on submissions (guest_id);

-- --- Per-guest history -------------------------------------------------------
create table if not exists history (
  id            uuid primary key default gen_random_uuid(),
  guest_id      text not null,
  kind          text not null check (kind in ('generated', 'contributed')),
  name          text not null,
  paths         jsonb not null check (jsonb_typeof(paths) = 'array'),
  created_at    timestamptz not null default now(),
  -- Null for a generation that was never contributed, and null again if the
  -- submission is later deleted: the history entry still happened.
  submission_id uuid references submissions (id) on delete set null
);

create index if not exists history_guest_created_idx on history (guest_id, created_at desc);

-- A convenience log, not an archive: only the newest 50 entries per guest are
-- kept. Enforced here rather than in the application so the bound holds no
-- matter which caller inserts, and so a guest's row count cannot be grown
-- without limit by repeated generation.
create or replace function trim_history() returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from history
  where guest_id = new.guest_id
    and id not in (
      select id from history
      where guest_id = new.guest_id
      order by created_at desc, id desc
      limit 50
    );
  return null;
end;
$$;

drop trigger if exists history_trim on history;
create trigger history_trim after insert on history
  for each row execute function trim_history();

-- --- Visit counters ----------------------------------------------------------
-- Uniqueness is judged by the same guest cookie history uses. No IP address is
-- read or stored, which keeps a gallery counter out of the way of anything that
-- would need a lawful basis of its own.
create table if not exists visit_guests (
  guest_id   text primary key,
  first_seen timestamptz not null default now()
);

create table if not exists site_counters (
  key   text primary key,
  value bigint not null default 0
);

-- One round trip, and the increment is atomic. Concurrent page loads through
-- read-modify-write in the application would lose counts.
--
-- `p_count` false reads the totals without recording, which is what the admin
-- page does so that reviewing icons never inflates the number.
--
-- Superseded by 0002: the visitor number moved from a count over visit_guests to
-- a counter row, so a page load no longer scans that table.
create or replace function record_visit(p_guest_id text, p_count boolean)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_views bigint;
  v_visitors bigint;
begin
  if p_count then
    insert into site_counters (key, value) values ('views', 1)
      on conflict (key) do update set value = site_counters.value + 1;
    if p_guest_id is not null and p_guest_id <> '' then
      insert into visit_guests (guest_id) values (p_guest_id)
        on conflict (guest_id) do nothing;
    end if;
  end if;

  select coalesce((select value from site_counters where key = 'views'), 0) into v_views;
  select count(*) from visit_guests into v_visitors;
  return json_build_object('views', v_views, 'visitors', v_visitors);
end;
$$;

-- --- Access ------------------------------------------------------------------
-- Every table is reached only through this project's own API, which does its own
-- authorization: the queue is behind an admin session, and history is scoped to
-- the caller's own guest id. So the browser never talks to PostgREST, and the
-- anon key is given nothing at all.
--
-- RLS on with no policies denies anon and authenticated outright; the grants are
-- revoked as well, so a leaked anon key (it is a public value by design) reads
-- nothing. `service_role` bypasses RLS, which is why that key is server-only and
-- must never be sent to a page.
alter table submissions   enable row level security;
alter table history       enable row level security;
alter table visit_guests  enable row level security;
alter table site_counters enable row level security;

revoke all on submissions, history, visit_guests, site_counters from anon, authenticated;
revoke all on function record_visit(text, boolean) from anon, authenticated;
revoke all on function trim_history() from anon, authenticated;

-- --- Retention ----------------------------------------------------------------
-- Handled by 0002, which adds prune_personal_data(days) covering all three
-- tables that hold personal data. Choosing the window and scheduling the call
-- are still open decisions; the function picks neither for you.
