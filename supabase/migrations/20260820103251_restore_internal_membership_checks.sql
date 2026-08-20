-- Keep the generic membership helpers available to trusted SECURITY DEFINER
-- functions without exposing spoofable user arguments through the Data API.

create or replace function public.is_room_member(target_room uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user is not null and exists (
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
  select viewer is not null and target is not null and exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = viewer
      and theirs.user_id = target
      and mine.is_active = true
      and theirs.is_active = true
  );
$$;

revoke all on function public.is_room_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shares_active_room(uuid, uuid) from public, anon, authenticated;

-- RLS-facing wrappers take only the target resource. The requesting identity is
-- always obtained from the JWT, so callers cannot probe another user's presence.
create or replace function public.is_current_user_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members rm
    where rm.room_id = target_room
      and rm.user_id = (select auth.uid())
      and rm.is_active = true
  );
$$;

create or replace function public.shares_current_user_active_room(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null and exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = target
      and mine.is_active = true
      and theirs.is_active = true
  );
$$;

revoke all on function public.is_current_user_room_member(uuid) from public, anon, authenticated;
revoke all on function public.shares_current_user_active_room(uuid) from public, anon, authenticated;
grant execute on function public.is_current_user_room_member(uuid) to authenticated;
grant execute on function public.shares_current_user_active_room(uuid) to authenticated;

alter policy rooms_read_owner_or_member on public.rooms
using (
  organizer_id = (select auth.uid())
  or public.is_current_user_room_member(id)
);

alter policy memberships_read_shared_room on public.room_members
using (
  user_id = (select auth.uid())
  or public.is_current_user_room_member(room_id)
);

alter policy drops_read_owner_or_member on public.drops
using (
  public.is_current_user_room_member(room_id)
  or exists (
    select 1
    from public.rooms r
    where r.id = drops.room_id
      and r.organizer_id = (select auth.uid())
  )
);

alter policy avatars_read_owner_or_shared_room on storage.objects
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.shares_current_user_active_room(
      public.safe_uuid((storage.foldername(name))[1])
    )
  )
);
