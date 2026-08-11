-- HERE MVP: PostgreSQL schema, server-side match logic, storage and RLS.
-- Apply with `supabase db push` or paste into the Supabase SQL editor once.

create extension if not exists pgcrypto;

create type public.app_role as enum ('USER', 'ORGANIZER');
create type public.room_status as enum ('DRAFT', 'UPCOMING', 'LIVE', 'CLOSED');
create type public.member_status as enum ('ACTIVE', 'LEFT', 'REMOVED');
create type public.report_status as enum ('OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 50),
  profile_photo text,
  date_of_birth date,
  bio text not null default '' check (char_length(bio) <= 280),
  interests text[] not null default '{}',
  gender text,
  interested_in text[] not null default '{}',
  purpose text check (purpose in ('Dating', 'Friends', 'Networking', 'Just meeting people')),
  open_to_meet boolean not null default false,
  role public.app_role not null default 'USER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{4,48}$'),
  name text not null check (char_length(name) between 2 and 80),
  event_name text not null check (char_length(event_name) between 2 and 120),
  venue_name text not null check (char_length(venue_name) between 2 and 120),
  city text not null check (char_length(city) between 2 and 80),
  description text not null default '' check (char_length(description) <= 1200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cover_image text,
  status public.room_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint rooms_valid_time check (ends_at > starts_at)
);

create table public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  is_visible boolean not null default false,
  status public.member_status not null default 'ACTIVE',
  unique (room_id, user_id)
);

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, sender_id, receiver_id),
  constraint interests_not_self check (sender_id <> receiver_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, user_a, user_b),
  constraint matches_ordered_pair check (user_a < user_b)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  reason text not null check (char_length(reason) between 3 and 120),
  details text not null default '' check (char_length(details) <= 1500),
  status public.report_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  constraint reports_not_self check (reporter_id <> reported_id)
);

create index rooms_organizer_created_idx on public.rooms (organizer_id, created_at desc);
create index rooms_status_time_idx on public.rooms (status, starts_at, ends_at);
create index room_members_room_visible_idx on public.room_members (room_id, is_visible) where status = 'ACTIVE';
create index room_members_user_idx on public.room_members (user_id, joined_at desc);
create index interests_receiver_idx on public.interests (receiver_id, room_id, created_at desc);
create index interests_room_created_idx on public.interests (room_id, created_at desc);
create index matches_user_a_idx on public.matches (user_a, created_at desc);
create index matches_user_b_idx on public.matches (user_b, created_at desc);
create index messages_match_created_idx on public.messages (match_id, created_at);
create index blocks_blocked_idx on public.blocks (blocked_id);
create index reports_status_created_idx on public.reports (status, created_at desc);

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

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger rooms_touch_updated_at before update on public.rooms
for each row execute function public.touch_updated_at();

create or replace function public.make_room_slug(input_name text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
begin
  base_slug := trim(both '-' from regexp_replace(lower(input_name), '[^a-z0-9]+', '-', 'g'));
  if char_length(base_slug) < 5 then base_slug := 'room-' || base_slug; end if;
  candidate := left(base_slug, 40) || '-' || lower(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  return candidate;
end;
$$;

create or replace function public.rooms_fill_slug()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.slug is null or trim(new.slug) = '' then
    new.slug := public.make_room_slug(new.name);
  end if;
  return new;
end;
$$;

create trigger rooms_fill_slug_trigger before insert on public.rooms
for each row execute function public.rooms_fill_slug();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'guest'), '@', 1)),
    case when new.raw_user_meta_data ->> 'role' = 'ORGANIZER' then 'ORGANIZER'::public.app_role else 'USER'::public.app_role end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_blocked_pair(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = first_user and blocked_id = second_user)
       or (blocker_id = second_user and blocked_id = first_user)
  );
$$;

create or replace function public.users_share_match(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matches
    where (user_a = least(first_user, second_user) and user_b = greatest(first_user, second_user))
  ) and not public.is_blocked_pair(first_user, second_user);
$$;

create or replace function public.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid()
    or public.users_share_match(auth.uid(), target_user)
    or exists (
      select 1
      from public.room_members viewer
      join public.room_members target on target.room_id = viewer.room_id
      join public.rooms room on room.id = viewer.room_id
      where viewer.user_id = auth.uid()
        and viewer.status = 'ACTIVE'
        and target.user_id = target_user
        and target.status = 'ACTIVE'
        and target.is_visible = true
        and room.status = 'LIVE'
        and not public.is_blocked_pair(auth.uid(), target_user)
    );
$$;

create or replace function public.can_view_membership(target_room uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid()
    or exists (select 1 from public.rooms where id = target_room and organizer_id = auth.uid())
    or exists (
      select 1 from public.room_members viewer
      join public.rooms room on room.id = viewer.room_id
      where viewer.room_id = target_room
        and viewer.user_id = auth.uid()
        and viewer.status = 'ACTIVE'
        and room.status = 'LIVE'
    ) and exists (
      select 1 from public.room_members target
      where target.room_id = target_room
        and target.user_id = target_user
        and target.status = 'ACTIVE'
        and target.is_visible = true
    ) and not public.is_blocked_pair(auth.uid(), target_user);
$$;

create or replace function public.is_match_participant(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.matches
    where id = target_match and (user_a = auth.uid() or user_b = auth.uid())
  );
$$;

create or replace function public.validate_age_gate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'You must be at least 18 years old';
  end if;
  return new;
end;
$$;

create trigger profiles_age_gate before insert or update of date_of_birth on public.profiles
for each row execute function public.validate_age_gate();

create or replace function public.set_message_sender()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  new.sender_id := auth.uid();
  return new;
end;
$$;

create trigger messages_set_authenticated_sender before insert on public.messages
for each row execute function public.set_message_sender();

create or replace function public.join_room(p_slug text)
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.rooms;
  membership public.room_members;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into target_room from public.rooms where slug = p_slug;
  if target_room.id is null then raise exception 'Room not found'; end if;
  if target_room.status not in ('UPCOMING', 'LIVE') then raise exception 'This room is not open'; end if;

  insert into public.room_members (room_id, user_id, status)
  values (target_room.id, auth.uid(), 'ACTIVE')
  on conflict (room_id, user_id) do update set status = 'ACTIVE'
  returning * into membership;
  return membership;
end;
$$;

create or replace function public.set_room_visibility(p_room_id uuid, p_visible boolean)
returns public.room_members
language plpgsql
security definer
set search_path = public
as $$
declare membership public.room_members;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.room_members
    set is_visible = p_visible
    where room_id = p_room_id and user_id = auth.uid() and status = 'ACTIVE'
    returning * into membership;
  if membership.id is null then raise exception 'Join the room before changing visibility'; end if;
  update public.profiles set open_to_meet = p_visible where id = auth.uid();
  return membership;
end;
$$;

create or replace function public.send_interest(p_room_id uuid, p_receiver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid := auth.uid();
  target_match public.matches;
  reciprocal boolean;
begin
  if sender is null then raise exception 'Authentication required'; end if;
  if sender = p_receiver_id then raise exception 'You cannot send interest to yourself'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and status = 'LIVE') then
    raise exception 'Interests are available only while the room is live';
  end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = sender and status = 'ACTIVE' and is_visible = true
  ) then raise exception 'Turn on Open to Meet first'; end if;
  if not exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = p_receiver_id and status = 'ACTIVE' and is_visible = true
  ) then raise exception 'This person is not visible in the room'; end if;
  if public.is_blocked_pair(sender, p_receiver_id) then raise exception 'This interaction is unavailable'; end if;

  insert into public.interests (room_id, sender_id, receiver_id)
  values (p_room_id, sender, p_receiver_id)
  on conflict (room_id, sender_id, receiver_id) do nothing;

  select exists (
    select 1 from public.interests
    where room_id = p_room_id and sender_id = p_receiver_id and receiver_id = sender
  ) into reciprocal;

  if reciprocal then
    insert into public.matches (room_id, user_a, user_b)
    values (p_room_id, least(sender, p_receiver_id), greatest(sender, p_receiver_id))
    on conflict (room_id, user_a, user_b) do update set room_id = excluded.room_id
    returning * into target_match;
  end if;

  return jsonb_build_object(
    'interest_sent', true,
    'matched', reciprocal,
    'match_id', case when reciprocal then target_match.id else null end
  );
end;
$$;

create or replace function public.room_analytics(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and organizer_id = auth.uid()) then
    raise exception 'Organizer access required';
  end if;
  return jsonb_build_object(
    'participants', (select count(*) from public.room_members where room_id = p_room_id),
    'visible_users', (select count(*) from public.room_members where room_id = p_room_id and is_visible and status = 'ACTIVE'),
    'interests_sent', (select count(*) from public.interests where room_id = p_room_id),
    'matches_created', (select count(*) from public.matches where room_id = p_room_id),
    'messages_started', (select count(distinct msg.match_id) from public.messages msg join public.matches m on m.id = msg.match_id where m.room_id = p_room_id)
  );
end;
$$;

grant execute on function public.join_room(text) to authenticated;
grant execute on function public.set_room_visibility(uuid, boolean) to authenticated;
grant execute on function public.send_interest(uuid, uuid) to authenticated;
grant execute on function public.room_analytics(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.interests enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

create policy "profiles_read_in_allowed_context" on public.profiles for select
  to authenticated using (public.can_view_profile(id));
create policy "profiles_insert_self" on public.profiles for insert
  to authenticated with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "rooms_public_event_info" on public.rooms for select
  to anon, authenticated using (status <> 'DRAFT' or organizer_id = auth.uid());
create policy "organizers_create_rooms" on public.rooms for insert
  to authenticated with check (
    organizer_id = auth.uid()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'ORGANIZER')
  );
create policy "organizers_update_own_rooms" on public.rooms for update
  to authenticated using (organizer_id = auth.uid()) with check (organizer_id = auth.uid());
create policy "organizers_delete_draft_rooms" on public.rooms for delete
  to authenticated using (organizer_id = auth.uid() and status = 'DRAFT');

create policy "memberships_read_allowed" on public.room_members for select
  to authenticated using (public.can_view_membership(room_id, user_id));
create policy "memberships_update_self" on public.room_members for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "interests_read_participants_or_owner" on public.interests for select
  to authenticated using (
    sender_id = auth.uid() or receiver_id = auth.uid()
    or exists (select 1 from public.rooms where id = room_id and organizer_id = auth.uid())
  );
-- Direct client inserts are intentionally omitted: send_interest() is the only write path.

create policy "matches_read_participants_or_owner" on public.matches for select
  to authenticated using (
    user_a = auth.uid() or user_b = auth.uid()
    or exists (select 1 from public.rooms where id = room_id and organizer_id = auth.uid())
  );
-- No client insert/update policy: matches are created only inside send_interest().

create policy "messages_read_match_participants" on public.messages for select
  to authenticated using (public.is_match_participant(match_id));
create policy "messages_send_as_self" on public.messages for insert
  to authenticated with check (sender_id = auth.uid() and public.is_match_participant(match_id));
create policy "messages_mark_read_as_participant" on public.messages for update
  to authenticated using (public.is_match_participant(match_id)) with check (public.is_match_participant(match_id));

create policy "blocks_read_own" on public.blocks for select
  to authenticated using (blocker_id = auth.uid());
create policy "blocks_create_own" on public.blocks for insert
  to authenticated with check (blocker_id = auth.uid());
create policy "blocks_remove_own" on public.blocks for delete
  to authenticated using (blocker_id = auth.uid());

create policy "reports_read_own" on public.reports for select
  to authenticated using (reporter_id = auth.uid());
create policy "reports_create_own" on public.reports for insert
  to authenticated with check (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "profile_photos_public_read" on storage.objects for select
  to public using (bucket_id = 'profile-photos');
create policy "profile_photos_insert_own_folder" on storage.objects for insert
  to authenticated with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_photos_update_own_folder" on storage.objects for update
  to authenticated using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "profile_photos_delete_own_folder" on storage.objects for delete
  to authenticated using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

alter publication supabase_realtime add table public.messages;
