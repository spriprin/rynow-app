-- HERE Sprint 3 live hardening.
-- Kept separate because the base Sprint 3 migration may already be recorded
-- as applied on production projects.

-- RLS policies are permissive by default. These restrictive guards ensure an
-- older or future permissive Room policy can never re-enable guest organizer
-- writes by OR-combination.
drop policy if exists "rooms_insert_permanent_guard" on public.rooms;
create policy "rooms_insert_permanent_guard"
on public.rooms as restrictive for insert to authenticated
with check (((select auth.jwt()) ->> 'is_anonymous')::boolean is false);

drop policy if exists "rooms_update_permanent_guard" on public.rooms;
create policy "rooms_update_permanent_guard"
on public.rooms as restrictive for update to authenticated
using (((select auth.jwt()) ->> 'is_anonymous')::boolean is false)
with check (((select auth.jwt()) ->> 'is_anonymous')::boolean is false);

-- Realtime inserts only need the primary key, but FULL identity also keeps the
-- chat stream safe for later UPDATE/DELETE events without another table change.
alter table public.messages replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
