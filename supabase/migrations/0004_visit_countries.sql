-- Per-country visit counters, for the admin page.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
--
-- Only two aggregate numbers per country: views and first-time visitors. The
-- country is never written next to a guest id, and no IP address is stored or
-- logged anywhere. A row here says "412 views from IN"; nothing in the schema can
-- say which device they came from.
--
-- That distinction is the whole design. A guest id is a device identifier, and a
-- device identifier plus a location is personal data under the DPDP Act 2023 —
-- it would need a retention window, a purpose, and a place in prune_personal_data.
-- A bare country tally needs none of that, and answers the question the admin
-- page actually asks.
--
-- WHERE THE COUNTRY COMES FROM
--
-- The `x-vercel-ip-country` request header, a two-letter ISO 3166-1 alpha-2 code
-- that the edge sets before the function runs. It costs nothing, needs no
-- dependency, and means the application never sees or handles an IP for this.
-- Requests without it — local development, a self-hosted deploy — record 'ZZ',
-- the ISO code reserved for "unknown", rather than being dropped.

create table if not exists visit_countries (
  -- ISO 3166-1 alpha-2, or 'ZZ' when the edge did not supply one.
  country   text primary key check (country ~ '^[A-Z]{2}$'),
  views     bigint not null default 0,
  visitors  bigint not null default 0,
  -- Useful for spotting a country that stopped appearing, without storing
  -- anything about an individual visit.
  last_seen timestamptz not null default now()
);

alter table visit_countries enable row level security;
-- No policies: every read and write goes through this project's own API using
-- the service_role key, which bypasses RLS. Leaving the table with RLS on and no
-- policy means a leaked anon key still reads nothing.
revoke all on table visit_countries from anon, authenticated;

-- --- record_visit, now with a country -----------------------------------------
-- The two-argument version is dropped rather than left beside this one: an
-- overload would let a caller quietly hit the old signature and stop counting
-- countries with no error.
drop function if exists record_visit(text, boolean);

create or replace function record_visit(p_guest_id text, p_count boolean, p_country text)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_views    bigint;
  v_visitors bigint;
  v_inserted integer := 0;
  v_country  text;
begin
  -- Anything that is not two letters becomes 'ZZ'. The check constraint would
  -- reject it otherwise, and a bad header must not fail the page load.
  v_country := upper(coalesce(nullif(trim(p_country), ''), 'ZZ'));
  if v_country !~ '^[A-Z]{2}$' then
    v_country := 'ZZ';
  end if;

  if p_count then
    insert into site_counters (key, value) values ('views', 1)
      on conflict (key) do update set value = site_counters.value + 1;

    insert into visit_countries (country, views, visitors)
      values (v_country, 1, 0)
      on conflict (country) do update
        set views = visit_countries.views + 1,
            last_seen = now();

    if p_guest_id is not null and p_guest_id <> '' then
      insert into visit_guests (guest_id) values (p_guest_id)
        on conflict (guest_id) do nothing;
      -- 0 when the guest was already known, 1 when this is their first visit.
      get diagnostics v_inserted = row_count;

      if v_inserted > 0 then
        insert into site_counters (key, value) values ('visitors', 1)
          on conflict (key) do update set value = site_counters.value + 1;

        -- A first-time device counts once, for the country it first arrived
        -- from. It is not re-attributed if the same device later appears
        -- elsewhere, because nothing records where it was counted.
        update visit_countries
           set visitors = visitors + 1
         where country = v_country;
      end if;
    end if;
  end if;

  select coalesce((select value from site_counters where key = 'views'), 0)    into v_views;
  select coalesce((select value from site_counters where key = 'visitors'), 0) into v_visitors;
  return json_build_object('views', v_views, 'visitors', v_visitors);
end;
$$;

revoke all on function record_visit(text, boolean, text) from anon, authenticated;
