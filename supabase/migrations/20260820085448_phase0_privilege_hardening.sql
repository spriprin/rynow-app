-- Keep RLS helper functions callable by authenticated policies without letting
-- clients use forged user ids as a cross-Room presence oracle.
create or replace function public.is_room_member(target_room uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid()) and exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room
      and rm.user_id = target_user
      and rm.is_active = true
  );
$$;

create or replace function public.shares_active_room(viewer uuid, target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer = (select auth.uid()) and target is not null and exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = viewer
      and theirs.user_id = target
      and mine.is_active = true
      and theirs.is_active = true
  );
$$;

revoke all on function public.is_room_member(uuid, uuid) from public, anon;
revoke all on function public.shares_active_room(uuid, uuid) from public, anon;
grant execute on function public.is_room_member(uuid, uuid) to authenticated;
grant execute on function public.shares_active_room(uuid, uuid) to authenticated;

-- Trigger helpers are invoked by Postgres itself and are not client RPCs.
revoke all on function public.rooms_set_join_code() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
