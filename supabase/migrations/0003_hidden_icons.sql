-- Lets an admin take any icon out of the gallery, including one the package
-- builds from raw-svgs/. Apply after 0002.
--
-- Hiding rather than deleting, for two reasons. The catalogue is derived on read
-- from docs/icons.json plus approved submissions, so there is no row to delete
-- for a built icon. And deleting artwork would mean removing files from the repo
-- mid-request, which on a deployed instance is a commit to the default branch —
-- too much to do behind a button pressed hundreds of times while sifting
-- duplicates. A hidden name is out of the gallery and out of the API
-- immediately, and `restore` puts it back.
--
-- Turning a hidden name into a smaller npm package is a separate, deliberate
-- step: read the list, remove those raw-svgs/ directories, rebuild.
create table if not exists hidden_icons (
  name      text primary key,
  hidden_at timestamptz not null default now(),
  -- Which admin, as far as this app knows: one shared credential, so this is
  -- "an admin" rather than a person. Kept for ordering and for a later move to
  -- per-admin identity.
  hidden_by text
);

-- The gallery reads the whole set on every catalogue build, so keep it ordered.
create index if not exists hidden_icons_hidden_at_idx on hidden_icons (hidden_at desc);

-- Same access rule as everything else here: reached only through this project's
-- API under the service_role key, never by a browser.
alter table hidden_icons enable row level security;
revoke all on hidden_icons from anon, authenticated;
