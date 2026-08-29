-- Replaced avatar paths must stop receiving new signed URLs immediately, even
-- when best-effort physical Storage cleanup is delayed by a transient failure.

create or replace function public.can_current_user_read_current_avatar(
  target uuid,
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null
    and object_name is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = target
        and p.avatar_path = object_name
    )
    and (
      target = (select auth.uid())
      or public.shares_active_room((select auth.uid()), target)
      or exists (
        select 1 from public.drop_items di
        where di.viewer_id = (select auth.uid()) and di.candidate_id = target
          and di.invalidated_at is null
      )
      or exists (
        select 1 from public.explore_items ei
        where ei.viewer_id = (select auth.uid()) and ei.candidate_id = target
          and ei.invalidated_at is null
      )
      or exists (
        select 1 from public.interests i
        where i.status = 'pending'
          and i.to_user_id = (select auth.uid())
          and i.from_user_id = target
          and not public.is_pair_blocked(i.from_user_id, i.to_user_id)
      )
      or exists (
        select 1 from public.matches m
        where (
          (m.user_a_id = (select auth.uid()) and m.user_b_id = target)
          or (m.user_b_id = (select auth.uid()) and m.user_a_id = target)
        )
          and not public.is_pair_blocked(m.user_a_id, m.user_b_id)
      )
    );
$$;

revoke all on function public.can_current_user_read_current_avatar(uuid, text)
from public, anon, authenticated;
grant execute on function public.can_current_user_read_current_avatar(uuid, text)
to authenticated;

alter policy avatars_read_owner_or_shared_room on storage.objects
using (
  bucket_id = 'avatars'
  and public.can_current_user_read_current_avatar(
    public.safe_uuid((storage.foldername(name))[1]),
    name
  )
);

-- The one-argument helper was previously callable only to support the Storage
-- policy. The policy above now uses the path-aware helper.
revoke all on function public.can_current_user_read_avatar(uuid)
from public, anon, authenticated;
