-- HERE Sprint 1: real rooms, persistent anonymous guests and room presence.
-- This is the complete foundation schema for a fresh Supabase project.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_path text,
  age_confirmed_18 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_profile_name check (char_length(trim(display_name)) between 2 and 50)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id),
  name text not null,
  venue_name text,
  city text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft',
  join_code text not null unique,
  cover_path text,
  created_at timestamptz not null default now(),
  constraint valid_room_status check (status in ('draft', 'open', 'closed')),
  constraint valid_room_dates check (ends_at > starts_at),
  constraint valid_room_name check (char_length(trim(name)) between 2 and 100),
  constraint valid_join_code check (join_code ~ '^[a-f0-9]{24}$')
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  primary key (room_id, user_id)
);

create index rooms_organizer_created_idx on public.rooms (organizer_id, created_at desc);
create index rooms_status_starts_idx on public.rooms (status, starts_at);
create index room_members_room_active_idx on public.room_members (room_id, is_active, joined_at);
create index room_members_user_seen_idx on public.room_members (user_id, last_seen_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.generate_join_code()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(extensions.gen_random_bytes(12), 'hex');
$$;

create or replace function public.rooms_set_join_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never trust a client-supplied public code. Every insert gets 96 random bits.
  loop
    new.join_code := public.generate_join_code();
    exit when not exists (select 1 from public.rooms where join_code = new.join_code);
  end loop;
  return new;
end;
$$;

create trigger rooms_set_join_code_trigger
before insert on public.rooms
for each row execute function public.rooms_set_join_code();

-- The BEFORE INSERT trigger supplies the value before NOT NULL is checked.
-- Keeping a function default here would execute it with the caller's rights.
alter table public.rooms alter column join_code drop default;

create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.is_room_member(target_room uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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
set search_path = public
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

create or replace function public.get_room_by_join_code(p_join_code text)
returns table (
  id uuid,
  name text,
  venue_name text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  join_code text,
  cover_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.name, r.venue_name, r.city, r.starts_at, r.ends_at,
         r.status, r.join_code, r.cover_path
  from public.rooms r
  where r.join_code = lower(trim(p_join_code))
  limit 1;
$$;

create or replace function public.join_room_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and char_length(trim(p.display_name)) >= 2
  ) then
    raise exception 'Complete your profile before joining';
  end if;

  select * into target_room
  from public.rooms r
  where r.join_code = lower(trim(p_join_code))
  for update;

  if target_room.id is null then
    raise exception 'Room not found';
  end if;
  if target_room.status = 'closed' then
    raise exception 'This Room has ended.';
  end if;
  if target_room.status <> 'open' then
    raise exception 'This Room is not open yet.';
  end if;

  insert into public.room_members (room_id, user_id, joined_at, last_seen_at, is_active)
  values (target_room.id, current_user_id, now(), now(), true)
  on conflict (room_id, user_id) do update
    set last_seen_at = excluded.last_seen_at,
        is_active = true;

  return target_room.id;
end;
$$;

create or replace function public.room_joined_count(p_room_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, auth.uid())
     and not exists (select 1 from public.rooms r where r.id = p_room_id and r.organizer_id = auth.uid()) then
    raise exception 'Room access required';
  end if;
  return (select count(*) from public.room_members rm where rm.room_id = p_room_id);
end;
$$;

create or replace function public.room_wall_profiles(p_room_id uuid, p_limit integer default 12)
returns table (
  id uuid,
  display_name text,
  avatar_path text,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_path, rm.joined_at
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = p_room_id
    and rm.is_active = true
    and public.is_room_member(p_room_id, auth.uid())
  order by rm.joined_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;

create policy "profiles_read_self"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

create policy "profiles_insert_self"
on public.profiles for insert
to authenticated
with check (
  id = (select auth.uid())
  and age_confirmed_18 = true
  and avatar_path is not null
  and split_part(avatar_path, '/', 1) = (select auth.uid())::text
);

create policy "profiles_update_self"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and age_confirmed_18 = true
  and avatar_path is not null
  and split_part(avatar_path, '/', 1) = (select auth.uid())::text
);

create policy "rooms_read_owner_or_member"
on public.rooms for select
to authenticated
using (
  organizer_id = (select auth.uid())
  or public.is_room_member(id, (select auth.uid()))
);

create policy "rooms_insert_permanent_organizer"
on public.rooms for insert
to authenticated
with check (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
);

create policy "rooms_update_owner"
on public.rooms for update
to authenticated
using (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
)
with check (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
);

create policy "memberships_read_shared_room"
on public.room_members for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.is_room_member(room_id, (select auth.uid()))
);

create policy "memberships_update_self"
on public.room_members for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
revoke all on public.rooms from anon, authenticated;
revoke all on public.room_members from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.rooms to authenticated;
grant select on public.room_members to authenticated;
grant update (last_seen_at, is_active) on public.room_members to authenticated;

revoke all on function public.get_room_by_join_code(text) from public;
revoke all on function public.join_room_by_code(text) from public;
revoke all on function public.room_joined_count(uuid) from public;
revoke all on function public.room_wall_profiles(uuid, integer) from public;
revoke all on function public.generate_join_code() from public;
revoke all on function public.safe_uuid(text) from public;
revoke all on function public.is_room_member(uuid, uuid) from public;
revoke all on function public.shares_active_room(uuid, uuid) from public;
grant execute on function public.get_room_by_join_code(text) to anon, authenticated;
grant execute on function public.join_room_by_code(text) to authenticated;
grant execute on function public.room_joined_count(uuid) to authenticated;
grant execute on function public.room_wall_profiles(uuid, integer) to authenticated;
grant execute on function public.safe_uuid(text) to authenticated;
grant execute on function public.is_room_member(uuid, uuid) to authenticated;
grant execute on function public.shares_active_room(uuid, uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars_read_owner_or_shared_room"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.shares_active_room(
      (select auth.uid()),
      public.safe_uuid((storage.foldername(name))[1])
    )
  )
);

create policy "avatars_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy "avatars_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);

create policy "avatars_delete_own_folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and owner_id = (select auth.uid())::text
);
