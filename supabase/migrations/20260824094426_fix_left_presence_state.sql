-- Sprint 5.1 follow-up: explicitly left participants remain historical Room
-- members and must be able to read their own state in order to Rejoin.

create or replace function public.room_presence_state(p_room_id uuid)
returns table (
  discovery_enabled boolean,
  left_at timestamptz,
  recently_active boolean,
  discovery_eligible boolean,
  server_now timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id = current_user_id
  ) then raise exception 'Room access required'; end if;
  return query
  select rm.discovery_enabled, rm.left_at,
         private.is_recently_active(p_room_id, current_user_id, database_now),
         private.is_discovery_eligible(p_room_id, current_user_id, database_now),
         database_now
  from public.room_members rm
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
end;
$$;

revoke all on function public.room_presence_state(uuid) from public, anon, authenticated;
grant execute on function public.room_presence_state(uuid) to authenticated;
