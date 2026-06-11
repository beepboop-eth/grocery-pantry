-- Light auth: every request must carry an x-pantry-key header matching the
-- value in private.config. The real passphrase is set directly in the DB
-- (never committed); this migration only installs the mechanism.
create schema if not exists private;

create table private.config (
  key text primary key,
  value text not null
);

insert into private.config (key, value) values ('pantry_key', 'CHANGE_ME');

create or replace function public.pantry_key_valid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.config
    where key = 'pantry_key'
      and value = current_setting('request.headers', true)::json->>'x-pantry-key'
  );
$$;

revoke all on function public.pantry_key_valid() from public;
grant execute on function public.pantry_key_valid() to anon;

drop policy "anon full access" on public.pantry_items;
create policy "passphrase required" on public.pantry_items
  for all to anon
  using (public.pantry_key_valid())
  with check (public.pantry_key_valid());
