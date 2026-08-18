-- Two changes to what 0001 set up. Apply it the same way, after 0001.
--
-- 1. The unique-visitor number stops being a count over `visit_guests` and
--    becomes a counter row, so a page load no longer scans a table that grows
--    by one row per visitor.
-- 2. Retention becomes a function you can schedule, covering all three tables
--    that hold personal data. 0001 described the deletes in a comment and left
--    `visit_guests` out of them.
--
-- The two are connected: while the visitor number was a live count, pruning
-- `visit_guests` would have made it fall. Reading it from a counter is what
-- makes deleting those rows safe.

-- --- Visitor counter ---------------------------------------------------------
-- Seed the counter from the rows that exist now, so the number does not restart.
insert into site_counters (key, value)
  values ('visitors', (select count(*) from visit_guests))
  on conflict (key) do update set value = excluded.value;

-- `visit_guests` is still written, and is still what decides whether a guest is
-- new — the counter only caches how many times that has been true. Deleting a
-- pruned guest's row therefore does not decrement it: the visit happened. The
-- cost is that a guest who returns after their row is pruned counts a second
-- time, which is the price of not keeping their id indefinitely.
create or replace function record_visit(p_guest_id text, p_count boolean)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_views    bigint;
  v_visitors bigint;
  v_inserted integer := 0;
begin
  if p_count then
    insert into site_counters (key, value) values ('views', 1)
      on conflict (key) do update set value = site_counters.value + 1;

    if p_guest_id is not null and p_guest_id <> '' then
      insert into visit_guests (guest_id) values (p_guest_id)
        on conflict (guest_id) do nothing;
      -- 0 when the guest was already known, 1 when this is their first visit.
      get diagnostics v_inserted = row_count;

      if v_inserted > 0 then
        insert into site_counters (key, value) values ('visitors', 1)
          on conflict (key) do update set value = site_counters.value + 1;
      end if;
    end if;
  end if;

  select coalesce((select value from site_counters where key = 'views'), 0)    into v_views;
  select coalesce((select value from site_counters where key = 'visitors'), 0) into v_visitors;
  return json_build_object('views', v_views, 'visitors', v_visitors);
end;
$$;

-- --- Retention ---------------------------------------------------------------
-- The DPDP Act 2023 expects personal data to be kept only as long as it serves
-- the purpose it was collected for. Three tables hold some:
--
--   history       a guest id and their generated drawings
--   submissions   a guest id and a self-chosen public display name
--   visit_guests  a guest id alone
--
-- The window is a decision, not a default, so this function takes it as an
-- argument and picks nothing for you. Schedule it once you have chosen one:
--
--   select cron.schedule('prune-personal-data', '0 3 * * *',
--                        $cron$select prune_personal_data(180)$cron$);
--
-- Pending submissions are never deleted: an unreviewed one is still doing the
-- job it was submitted for, however old it is.
--
-- Deleting an approved submission also removes the icon from the gallery, since
-- the catalogue is derived from these rows. Publish approved icons into
-- raw-svgs/ and rebuild before the window catches up with them.
create or replace function prune_personal_data(p_days integer)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cutoff      timestamptz;
  v_history     integer;
  v_submissions integer;
  v_guests      integer;
begin
  if p_days is null or p_days < 1 then
    raise exception 'p_days must be a positive number of days, got %', p_days;
  end if;
  v_cutoff := now() - make_interval(days => p_days);

  delete from history where created_at < v_cutoff;
  get diagnostics v_history = row_count;

  delete from submissions
   where status in ('approved', 'rejected')
     and reviewed_at is not null
     and reviewed_at < v_cutoff;
  get diagnostics v_submissions = row_count;

  -- Safe to delete now that the visitor number is a counter rather than a count
  -- over this table. Keyed on first_seen: a guest id is personal data for as
  -- long as it is stored, and nothing here needs it after the window.
  delete from visit_guests where first_seen < v_cutoff;
  get diagnostics v_guests = row_count;

  return json_build_object(
    'cutoff', v_cutoff,
    'history', v_history,
    'submissions', v_submissions,
    'visit_guests', v_guests
  );
end;
$$;

-- Same access rule as everything in 0001: reached only by this project's API
-- under the service_role key, never by a browser.
revoke all on function record_visit(text, boolean) from anon, authenticated;
revoke all on function prune_personal_data(integer) from anon, authenticated;
