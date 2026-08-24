-- HERE Sprint 5.1: pre-pilot core revision.
--
-- This additive migration separates recent social proof from discovery
-- eligibility, adds explicit Leave/Rejoin semantics, introduces persistent
-- always-on Explore batches, shares Fair Exposure across Explore and Drops,
-- and calculates Interest Budget from the actual batch size.

alter table public.room_members
  add column if not exists discovery_enabled boolean not null default true,
  add column if not exists left_at timestamptz;

update public.room_members
set discovery_enabled = is_active,
    left_at = case when is_active then null else coalesce(left_at, last_seen_at) end;

create index if not exists room_members_room_recent_10m_idx
  on public.room_members (room_id, last_seen_at desc)
  where is_active = true and discovery_enabled = true and left_at is null;

create index if not exists room_members_room_discovery_idx
  on public.room_members (room_id, discovery_enabled, last_seen_at desc)
  where is_active = true and left_at is null;

alter table public.drop_items
  add column if not exists invalidated_at timestamptz;

alter table public.drop_items
  drop constraint if exists valid_drop_item_position;

alter table public.drop_items
  add constraint valid_drop_item_position check (position >= 1 and position <= 1000);

create index if not exists drop_items_room_candidate_exposure_idx
  on public.drop_items (room_id, candidate_id, first_seen_at, invalidated_at);

create index if not exists drop_items_viewer_pending_idx
  on public.drop_items (room_id, viewer_id, candidate_id)
  where first_seen_at is null and invalidated_at is null;

create table public.explore_batches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  sequence_number integer not null,
  target_size integer not null check (target_size between 1 and 10),
  interest_budget integer not null default 0 check (interest_budget between 0 and 10),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  cooldown_until timestamptz,
  constraint explore_batches_viewer_membership_fk
    foreign key (room_id, viewer_id)
    references public.room_members(room_id, user_id) on delete cascade,
  constraint explore_batches_id_room_unique unique (id, room_id),
  constraint explore_batches_viewer_sequence_unique
    unique (room_id, viewer_id, sequence_number),
  constraint explore_batches_completion_consistent
    check (
      (completed_at is null and cooldown_until is null)
      or
      (completed_at is not null and cooldown_until is not null and cooldown_until >= completed_at)
    )
);

create unique index explore_batches_one_active_viewer_idx
  on public.explore_batches (room_id, viewer_id)
  where completed_at is null;

create index explore_batches_room_created_idx
  on public.explore_batches (room_id, created_at desc);

create table public.explore_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.explore_batches(id) on delete cascade,
  room_id uuid not null,
  viewer_id uuid not null,
  candidate_id uuid not null,
  position integer not null check (position >= 1 and position <= 1000),
  created_at timestamptz not null default clock_timestamp(),
  first_seen_at timestamptz,
  action text check (action is null or action in ('passed', 'interested')),
  invalidated_at timestamptz,
  constraint explore_item_not_self check (viewer_id <> candidate_id),
  constraint explore_items_batch_identity_unique
    unique (id, batch_id, room_id, viewer_id, candidate_id),
  constraint explore_items_viewer_candidate_unique
    unique (batch_id, viewer_id, candidate_id),
  constraint explore_items_viewer_position_unique
    unique (batch_id, viewer_id, position),
  constraint explore_items_batch_room_fk
    foreign key (batch_id, room_id)
    references public.explore_batches(id, room_id) on delete cascade,
  constraint explore_items_viewer_membership_fk
    foreign key (room_id, viewer_id)
    references public.room_members(room_id, user_id) on delete cascade,
  constraint explore_items_candidate_membership_fk
    foreign key (room_id, candidate_id)
    references public.room_members(room_id, user_id) on delete cascade
);

create index explore_items_room_candidate_exposure_idx
  on public.explore_items (room_id, candidate_id, first_seen_at, invalidated_at);

create index explore_items_viewer_pending_idx
  on public.explore_items (room_id, viewer_id, candidate_id)
  where first_seen_at is null and invalidated_at is null;

alter table public.explore_batches enable row level security;
alter table public.explore_items enable row level security;
revoke all on public.explore_batches from anon, authenticated;
revoke all on public.explore_items from anon, authenticated;

alter table public.interests
  alter column drop_id drop not null,
  alter column drop_item_id drop not null,
  add column if not exists explore_batch_id uuid,
  add column if not exists explore_item_id uuid;

alter table public.interests
  add constraint interests_explore_assigned_item_fk
    foreign key (explore_item_id, explore_batch_id, room_id, from_user_id, to_user_id)
    references public.explore_items(id, batch_id, room_id, viewer_id, candidate_id)
    on delete cascade,
  add constraint interests_one_per_explore_item unique (explore_item_id),
  add constraint interests_exactly_one_discovery_source check (
    (
      drop_id is not null and drop_item_id is not null
      and explore_batch_id is null and explore_item_id is null
    )
    or
    (
      drop_id is null and drop_item_id is null
      and explore_batch_id is not null and explore_item_id is not null
    )
  );

create index if not exists interests_explore_batch_sender_idx
  on public.interests (explore_batch_id, from_user_id)
  where explore_batch_id is not null;

create or replace function private.adaptive_interest_budget(p_batch_size integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_batch_size, 0) <= 0 then 0
    when p_batch_size <= 5 then p_batch_size
    else ceil(p_batch_size::numeric * 0.5)::integer
  end;
$$;

create or replace function private.explore_target_size(p_eligible integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_eligible, 0) <= 0 then 0
    when p_eligible <= 5 then p_eligible
    when p_eligible <= 11 then 6
    when p_eligible <= 49 then 8
    else 10
  end;
$$;

create or replace function private.is_recently_active(
  p_room_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_members rm on rm.room_id = r.id
    where r.id = p_room_id
      and r.status = 'open'
      and rm.user_id = p_user_id
      and rm.is_active = true
      and rm.discovery_enabled = true
      and rm.left_at is null
      and rm.last_seen_at >= p_now - interval '10 minutes'
  );
$$;

create or replace function private.is_discovery_eligible(
  p_room_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_members rm on rm.room_id = r.id
    join public.profiles p on p.id = rm.user_id
    where r.id = p_room_id
      and r.status = 'open'
      and rm.user_id = p_user_id
      and rm.is_active = true
      and rm.discovery_enabled = true
      and rm.left_at is null
      and rm.last_seen_at >= p_now - interval '60 minutes'
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and char_length(btrim(p.display_name)) >= 2
  );
$$;

create or replace function private.viewer_has_seen_candidate(
  p_room_id uuid,
  p_viewer_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.drop_items di
    where di.room_id = p_room_id
      and di.viewer_id = p_viewer_id
      and di.candidate_id = p_candidate_id
      and di.first_seen_at is not null
    union all
    select 1 from public.explore_items ei
    where ei.room_id = p_room_id
      and ei.viewer_id = p_viewer_id
      and ei.candidate_id = p_candidate_id
      and ei.first_seen_at is not null
  );
$$;

create or replace function private.viewer_has_pending_candidate(
  p_room_id uuid,
  p_viewer_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.drop_items di
    where di.room_id = p_room_id
      and di.viewer_id = p_viewer_id
      and di.candidate_id = p_candidate_id
      and di.first_seen_at is null
      and di.invalidated_at is null
    union all
    select 1 from public.explore_items ei
    where ei.room_id = p_room_id
      and ei.viewer_id = p_viewer_id
      and ei.candidate_id = p_candidate_id
      and ei.first_seen_at is null
      and ei.invalidated_at is null
  );
$$;

create or replace function private.discovery_delivered_count(
  p_room_id uuid,
  p_candidate_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $$
  select (
    (select count(*) from public.drop_items di
     where di.room_id = p_room_id and di.candidate_id = p_candidate_id
       and di.first_seen_at is not null)
    +
    (select count(*) from public.explore_items ei
     where ei.room_id = p_room_id and ei.candidate_id = p_candidate_id
       and ei.first_seen_at is not null)
  )::integer;
$$;

create or replace function private.discovery_pending_count(
  p_room_id uuid,
  p_candidate_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $$
  select (
    (select count(*) from public.drop_items di
     where di.room_id = p_room_id and di.candidate_id = p_candidate_id
       and di.first_seen_at is null and di.invalidated_at is null)
    +
    (select count(*) from public.explore_items ei
     where ei.room_id = p_room_id and ei.candidate_id = p_candidate_id
       and ei.first_seen_at is null and ei.invalidated_at is null)
  )::integer;
$$;

create or replace function private.invalidate_stale_discovery_assignments(
  p_room_id uuid,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.drop_items di
  set invalidated_at = coalesce(di.invalidated_at, p_now)
  where di.room_id = p_room_id
    and di.first_seen_at is null
    and di.invalidated_at is null
    and not private.is_discovery_eligible(p_room_id, di.candidate_id, p_now);

  update public.explore_items ei
  set invalidated_at = coalesce(ei.invalidated_at, p_now)
  where ei.room_id = p_room_id
    and ei.first_seen_at is null
    and ei.invalidated_at is null
    and not private.is_discovery_eligible(p_room_id, ei.candidate_id, p_now);
end;
$$;

create or replace function public.join_room_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_room public.rooms;
  joined_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and char_length(btrim(p.display_name)) >= 2
  ) then
    raise exception 'Complete your profile before joining';
  end if;

  select * into target_room
  from public.rooms r
  where r.join_code = lower(btrim(p_join_code))
  for update;
  if target_room.id is null then raise exception 'Room not found'; end if;
  if target_room.status = 'closed' then raise exception 'This Room has ended.'; end if;
  if target_room.status <> 'open' then raise exception 'This Room is not open yet.'; end if;

  insert into public.room_members (
    room_id, user_id, joined_at, last_seen_at, is_active,
    discovery_enabled, left_at
  ) values (
    target_room.id, current_user_id, joined_now, joined_now, true, true, null
  )
  on conflict (room_id, user_id) do update
  set last_seen_at = case
        when public.room_members.discovery_enabled then excluded.last_seen_at
        else public.room_members.last_seen_at
      end,
      is_active = public.room_members.discovery_enabled;

  return target_room.id;
end;
$$;

create or replace function public.heartbeat_room_presence(p_room_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  heartbeat_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;

  update public.room_members rm
  set last_seen_at = heartbeat_at,
      is_active = rm.discovery_enabled and rm.left_at is null
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
  if not found then raise exception 'Room membership required'; end if;
  return heartbeat_at;
end;
$$;

create or replace function public.leave_room_presence(p_room_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  departure_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  update public.room_members rm
  set last_seen_at = departure_at,
      is_active = false,
      discovery_enabled = false,
      left_at = coalesce(rm.left_at, departure_at)
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
  if not found then raise exception 'Room membership required'; end if;

  update public.drop_items di
  set invalidated_at = coalesce(di.invalidated_at, departure_at)
  where di.room_id = p_room_id and di.candidate_id = current_user_id
    and di.first_seen_at is null and di.invalidated_at is null;
  update public.explore_items ei
  set invalidated_at = coalesce(ei.invalidated_at, departure_at)
  where ei.room_id = p_room_id and ei.candidate_id = current_user_id
    and ei.first_seen_at is null and ei.invalidated_at is null;
  return departure_at;
end;
$$;

create or replace function public.rejoin_room_presence(p_room_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  rejoined_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  update public.room_members rm
  set last_seen_at = rejoined_at,
      is_active = true,
      discovery_enabled = true,
      left_at = null
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
  if not found then raise exception 'Room membership required'; end if;
  return rejoined_at;
end;
$$;

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
  if not public.is_room_member(p_room_id, current_user_id) then raise exception 'Room access required'; end if;
  return query
  select rm.discovery_enabled, rm.left_at,
         private.is_recently_active(p_room_id, current_user_id, database_now),
         private.is_discovery_eligible(p_room_id, current_user_id, database_now),
         database_now
  from public.room_members rm
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
end;
$$;

alter function public.organizer_room_presence_counts()
  rename to organizer_room_presence_counts_sprint5_internal;
revoke all on function public.organizer_room_presence_counts_sprint5_internal()
  from public, anon, authenticated;

create function public.organizer_room_presence_counts()
returns table (
  room_id uuid,
  joined_count bigint,
  recent_count bigint,
  eligible_count bigint,
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
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'Permanent organizer account required';
  end if;
  return query
  select r.id,
         count(rm.user_id)::bigint,
         count(rm.user_id) filter (
           where rm.is_active and rm.discovery_enabled and rm.left_at is null
             and rm.last_seen_at >= database_now - interval '10 minutes'
         )::bigint,
         count(rm.user_id) filter (
           where rm.is_active and rm.discovery_enabled and rm.left_at is null
             and rm.last_seen_at >= database_now - interval '60 minutes'
         )::bigint,
         database_now
  from public.rooms r
  left join public.room_members rm on rm.room_id = r.id
  where r.organizer_id = current_user_id
  group by r.id;
end;
$$;

create or replace function public.room_wall_profiles(p_room_id uuid, p_limit integer default 12)
returns table (id uuid, display_name text, avatar_path text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_path, rm.joined_at
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = p_room_id
    and rm.is_active = true
    and rm.discovery_enabled = true
    and rm.left_at is null
    and rm.last_seen_at >= now() - interval '10 minutes'
    and private.is_recently_active(p_room_id, (select auth.uid()), now())
  order by rm.last_seen_at desc, rm.joined_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
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
    from public.room_members a
    join public.room_members b on b.room_id = a.room_id
    join public.rooms r on r.id = a.room_id
    where a.user_id = viewer and b.user_id = target
      and r.status = 'open'
      and a.is_active and a.discovery_enabled and a.left_at is null
      and b.is_active and b.discovery_enabled and b.left_at is null
      and a.last_seen_at >= now() - interval '10 minutes'
      and b.last_seen_at >= now() - interval '10 minutes'
  );
$$;

create or replace function public.shares_current_user_active_room(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.shares_active_room((select auth.uid()), target);
$$;

create or replace function public.room_drop_state(p_room_id uuid)
returns table (
  drop_id uuid, sequence_number integer, scheduled_at timestamptz,
  effective_open_at timestamptz, drop_size integer, min_unlock_count integer,
  interest_budget integer, assigned_count integer, remaining_count integer,
  interests_used integer, eligible_count integer, active_candidate_count integer,
  next_scheduled_at timestamptz, server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_drop public.drops;
  next_time timestamptz;
  assigned_total integer := 0;
  remaining_total integer := 0;
  used_total integer := 0;
  eligible_total integer := 0;
  active_total integer := 0;
  dynamic_budget integer := 0;
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, current_user_id) then raise exception 'Room access required'; end if;

  select d.* into current_drop
  from public.drops d
  where d.room_id = p_room_id
    and coalesce(d.opened_at, d.scheduled_at) <= database_now
  order by coalesce(d.opened_at, d.scheduled_at) desc, d.sequence_number desc
  limit 1;

  select min(d.scheduled_at) into next_time
  from public.drops d
  where d.room_id = p_room_id and d.opened_at is null and d.scheduled_at > database_now;

  if current_drop.id is not null then
    perform private.invalidate_stale_discovery_assignments(p_room_id, database_now);
    select count(*)::integer,
           count(*) filter (where di.action is null)::integer
    into assigned_total, remaining_total
    from public.drop_items di
    where di.drop_id = current_drop.id and di.viewer_id = current_user_id
      and di.invalidated_at is null
      and not public.is_pair_blocked(current_user_id, di.candidate_id);

    dynamic_budget := private.adaptive_interest_budget(assigned_total);
    select count(*)::integer into used_total from public.interests i
    where i.drop_id = current_drop.id and i.from_user_id = current_user_id;

    select count(*)::integer into active_total
    from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id <> current_user_id
      and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
      and not public.is_pair_blocked(current_user_id, rm.user_id);

    select count(*)::integer into eligible_total
    from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id <> current_user_id
      and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
      and not public.is_pair_blocked(current_user_id, rm.user_id)
      and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
      and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id)
      and not exists (
        select 1 from public.interests i where i.room_id = p_room_id
          and ((i.from_user_id = current_user_id and i.to_user_id = rm.user_id)
            or (i.from_user_id = rm.user_id and i.to_user_id = current_user_id))
      );
  end if;

  return query select current_drop.id, current_drop.sequence_number,
    current_drop.scheduled_at, coalesce(current_drop.opened_at, current_drop.scheduled_at),
    least(current_drop.drop_size, 12), current_drop.min_unlock_count,
    dynamic_budget, assigned_total, remaining_total, used_total, eligible_total,
    active_total, next_time, database_now;
end;
$$;

create or replace function public.claim_your_drop(p_drop_id uuid)
returns table (
  id uuid, item_position integer, first_seen_at timestamptz, action text,
  candidate_id uuid, display_name text, avatar_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_drop public.drops;
  database_now timestamptz := clock_timestamp();
  eligible_total integer := 0;
  valid_total integer := 0;
  fill_total integer := 0;
  max_position integer := 0;
  target_size integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_drop from public.drops d where d.id = p_drop_id for update;
  if target_drop.id is null then raise exception 'Drop not found'; end if;
  if coalesce(target_drop.opened_at, target_drop.scheduled_at) > database_now then raise exception 'This Drop is not open yet'; end if;
  if not private.is_discovery_eligible(target_drop.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;

  insert into private.drop_claim_states (drop_id, room_id, viewer_id, first_attempted_at)
  values (target_drop.id, target_drop.room_id, current_user_id, database_now)
  on conflict (drop_id, viewer_id) do nothing;

  perform private.invalidate_stale_discovery_assignments(target_drop.room_id, database_now);
  target_size := least(target_drop.drop_size, 12);

  select count(*)::integer, coalesce(max(di.position), 0)::integer
  into valid_total, max_position
  from public.drop_items di
  where di.drop_id = target_drop.id and di.viewer_id = current_user_id
    and di.invalidated_at is null;

  select count(*)::integer into eligible_total
  from public.room_members rm
  where rm.room_id = target_drop.room_id and rm.user_id <> current_user_id
    and private.is_discovery_eligible(target_drop.room_id, rm.user_id, database_now)
    and not public.is_pair_blocked(current_user_id, rm.user_id)
    and not private.viewer_has_seen_candidate(target_drop.room_id, current_user_id, rm.user_id)
    and not private.viewer_has_pending_candidate(target_drop.room_id, current_user_id, rm.user_id)
    and not exists (
      select 1 from public.interests i where i.room_id = target_drop.room_id
        and ((i.from_user_id = current_user_id and i.to_user_id = rm.user_id)
          or (i.from_user_id = rm.user_id and i.to_user_id = current_user_id))
    );

  if valid_total = 0 and eligible_total < least(target_drop.min_unlock_count, target_size) then
    update private.drop_claim_states set forming_at = coalesce(forming_at, database_now)
    where drop_id = target_drop.id and viewer_id = current_user_id;
    return;
  end if;

  fill_total := greatest(0, target_size - valid_total);
  if fill_total > 0 then
    insert into public.drop_items (drop_id, room_id, viewer_id, candidate_id, position)
    with candidate_exposure as (
      select rm.user_id as candidate_id,
        private.discovery_delivered_count(target_drop.room_id, rm.user_id) as delivered_count,
        private.discovery_pending_count(target_drop.room_id, rm.user_id) as pending_count
      from public.room_members rm
      where rm.room_id = target_drop.room_id and rm.user_id <> current_user_id
        and private.is_discovery_eligible(target_drop.room_id, rm.user_id, database_now)
        and not public.is_pair_blocked(current_user_id, rm.user_id)
        and not private.viewer_has_seen_candidate(target_drop.room_id, current_user_id, rm.user_id)
        and not private.viewer_has_pending_candidate(target_drop.room_id, current_user_id, rm.user_id)
        and not exists (
          select 1 from public.interests i where i.room_id = target_drop.room_id
            and ((i.from_user_id = current_user_id and i.to_user_id = rm.user_id)
              or (i.from_user_id = rm.user_id and i.to_user_id = current_user_id))
        )
    ), ranked as (
      select ce.candidate_id,
        row_number() over (
          order by floor((ce.delivered_count + ce.pending_count)::numeric / 2),
                   random(), ce.delivered_count + ce.pending_count, ce.candidate_id
        )::integer as row_position
      from candidate_exposure ce
    )
    select target_drop.id, target_drop.room_id, current_user_id,
           ranked.candidate_id, max_position + ranked.row_position
    from ranked where ranked.row_position <= fill_total
    order by ranked.row_position;
  end if;

  if exists (
    select 1 from public.drop_items di where di.drop_id = target_drop.id
      and di.viewer_id = current_user_id and di.invalidated_at is null
  ) then
    update private.drop_claim_states set unlocked_at = coalesce(unlocked_at, clock_timestamp())
    where drop_id = target_drop.id and viewer_id = current_user_id;
  end if;

  return query
  select di.id, di.position, di.first_seen_at, di.action, di.candidate_id,
         p.display_name, p.avatar_path
  from public.drop_items di join public.profiles p on p.id = di.candidate_id
  where di.drop_id = target_drop.id and di.viewer_id = current_user_id
    and di.invalidated_at is null
    and not public.is_pair_blocked(current_user_id, di.candidate_id)
  order by di.position;
end;
$$;

create or replace function public.mark_drop_item_seen(p_drop_item_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.drop_items;
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Drop item not found'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  if not private.is_discovery_eligible(target_item.room_id, target_item.candidate_id, database_now) then
    update public.drop_items set invalidated_at = database_now where id = target_item.id and first_seen_at is null;
    raise exception 'This person is no longer available';
  end if;
  update public.drop_items set first_seen_at = coalesce(first_seen_at, database_now)
  where id = target_item.id returning first_seen_at into database_now;
  return database_now;
end;
$$;

create or replace function public.pass_drop_item(p_drop_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); target_item public.drop_items;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Drop item not found'; end if;
  if target_item.first_seen_at is null then raise exception 'Show the card before continuing'; end if;
  if target_item.action = 'interested' then raise exception 'Interest already sent'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, clock_timestamp()) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  update public.drop_items set action = 'passed' where id = target_item.id and action is null;
end;
$$;

create or replace function public.send_interest(p_drop_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.drop_items;
  allowed_budget integer;
  used_budget integer;
  assigned_total integer;
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Drop item not found'; end if;
  perform pg_advisory_xact_lock(hashtext(current_user_id::text), hashtext(target_item.drop_id::text));
  if target_item.first_seen_at is null then raise exception 'Show the card before sending Interest'; end if;
  if target_item.action is not null then raise exception 'This card was already handled'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  if not private.is_discovery_eligible(target_item.room_id, target_item.candidate_id, database_now)
     or public.is_pair_blocked(current_user_id, target_item.candidate_id) then
    raise exception 'This interaction is unavailable';
  end if;
  if exists (
    select 1 from public.interests i where i.room_id = target_item.room_id
      and ((i.from_user_id = current_user_id and i.to_user_id = target_item.candidate_id)
        or (i.from_user_id = target_item.candidate_id and i.to_user_id = current_user_id))
  ) then raise exception 'Interest already sent to this person'; end if;

  select count(*)::integer into assigned_total from public.drop_items di
  where di.drop_id = target_item.drop_id and di.viewer_id = current_user_id
    and di.invalidated_at is null;
  allowed_budget := private.adaptive_interest_budget(assigned_total);
  select count(*)::integer into used_budget from public.interests i
  where i.drop_id = target_item.drop_id and i.from_user_id = current_user_id;
  if used_budget >= allowed_budget then raise exception 'No Interests left in this Drop'; end if;

  insert into public.interests (room_id, drop_id, drop_item_id, from_user_id, to_user_id)
  values (target_item.room_id, target_item.drop_id, target_item.id, current_user_id, target_item.candidate_id);
  update public.drop_items set action = 'interested' where id = target_item.id;
  return allowed_budget - used_budget - 1;
end;
$$;

create or replace function public.explore_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  database_now timestamptz := clock_timestamp();
  membership public.room_members;
  active_batch public.explore_batches;
  last_batch public.explore_batches;
  assigned_total integer := 0;
  remaining_total integer := 0;
  used_total integer := 0;
  new_total integer := 0;
  state text := 'ready';
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into membership from public.room_members rm
  where rm.room_id = p_room_id and rm.user_id = current_user_id;
  if membership.room_id is null then raise exception 'Room access required'; end if;
  if not membership.discovery_enabled or membership.left_at is not null then state := 'left'; end if;

  select * into active_batch from public.explore_batches eb
  where eb.room_id = p_room_id and eb.viewer_id = current_user_id and eb.completed_at is null
  order by eb.sequence_number desc limit 1;
  if active_batch.id is not null then
    select count(*)::integer, count(*) filter (where ei.action is null)::integer
    into assigned_total, remaining_total from public.explore_items ei
    where ei.batch_id = active_batch.id and ei.invalidated_at is null;
    select count(*)::integer into used_total from public.interests i
    where i.explore_batch_id = active_batch.id and i.from_user_id = current_user_id;
    if state <> 'left' then state := 'active'; end if;
  else
    select * into last_batch from public.explore_batches eb
    where eb.room_id = p_room_id and eb.viewer_id = current_user_id and eb.completed_at is not null
    order by eb.sequence_number desc limit 1;
    if last_batch.id is not null and last_batch.cooldown_until > database_now and state <> 'left' then
      select count(*)::integer into new_total
      from public.room_members rm
      where rm.room_id = p_room_id and rm.user_id <> current_user_id
        and rm.joined_at > last_batch.created_at
        and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
        and not public.is_pair_blocked(current_user_id, rm.user_id)
        and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
        and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id);
      state := case when new_total >= 3 then 'ready' else 'caught_up' end;
    end if;
  end if;

  return jsonb_build_object(
    'status', state,
    'batch_id', active_batch.id,
    'assigned_count', assigned_total,
    'remaining_count', remaining_total,
    'interest_budget', coalesce(active_batch.interest_budget, 0),
    'interests_used', used_total,
    'cooldown_until', coalesce(active_batch.cooldown_until, last_batch.cooldown_until),
    'discovery_enabled', membership.discovery_enabled,
    'left_at', membership.left_at,
    'server_now', database_now
  );
end;
$$;

create or replace function public.claim_explore_batch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  database_now timestamptz := clock_timestamp();
  active_batch public.explore_batches;
  last_batch public.explore_batches;
  eligible_total integer := 0;
  new_total integer := 0;
  target_total integer := 0;
  valid_total integer := 0;
  fill_total integer := 0;
  max_position integer := 0;
  next_sequence integer := 1;
  used_total integer := 0;
  item_payload jsonb := '[]'::jsonb;
  state_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not private.is_discovery_eligible(p_room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_room_id::text), hashtext('ambient-explore'));
  perform private.invalidate_stale_discovery_assignments(p_room_id, database_now);

  select * into active_batch from public.explore_batches eb
  where eb.room_id = p_room_id and eb.viewer_id = current_user_id and eb.completed_at is null
  order by eb.sequence_number desc limit 1 for update;

  if active_batch.id is null then
    select * into last_batch from public.explore_batches eb
    where eb.room_id = p_room_id and eb.viewer_id = current_user_id and eb.completed_at is not null
    order by eb.sequence_number desc limit 1;

    if last_batch.id is not null and last_batch.cooldown_until > database_now then
      select count(*)::integer into new_total from public.room_members rm
      where rm.room_id = p_room_id and rm.user_id <> current_user_id
        and rm.joined_at > last_batch.created_at
        and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
        and not public.is_pair_blocked(current_user_id, rm.user_id)
        and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
        and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id);
      if new_total < 3 then return public.explore_state(p_room_id); end if;
    end if;

    select count(*)::integer into eligible_total from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id <> current_user_id
      and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
      and not public.is_pair_blocked(current_user_id, rm.user_id)
      and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
      and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id)
      and not exists (
        select 1 from public.interests i where i.room_id = p_room_id
          and ((i.from_user_id = current_user_id and i.to_user_id = rm.user_id)
            or (i.from_user_id = rm.user_id and i.to_user_id = current_user_id))
      );
    target_total := private.explore_target_size(eligible_total);
    if target_total = 0 then
      state_payload := public.explore_state(p_room_id);
      return jsonb_set(state_payload, '{status}', '"waiting"'::jsonb, true);
    end if;

    select coalesce(max(eb.sequence_number), 0) + 1 into next_sequence
    from public.explore_batches eb where eb.room_id = p_room_id and eb.viewer_id = current_user_id;
    insert into public.explore_batches (room_id, viewer_id, sequence_number, target_size)
    values (p_room_id, current_user_id, next_sequence, target_total)
    returning * into active_batch;
  end if;

  select count(*)::integer, coalesce(max(ei.position), 0)::integer
  into valid_total, max_position from public.explore_items ei
  where ei.batch_id = active_batch.id and ei.invalidated_at is null;
  fill_total := greatest(0, active_batch.target_size - valid_total);

  if fill_total > 0 then
    insert into public.explore_items (batch_id, room_id, viewer_id, candidate_id, position)
    with candidate_exposure as (
      select rm.user_id as candidate_id,
        private.discovery_delivered_count(p_room_id, rm.user_id) as delivered_count,
        private.discovery_pending_count(p_room_id, rm.user_id) as pending_count
      from public.room_members rm
      where rm.room_id = p_room_id and rm.user_id <> current_user_id
        and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
        and not public.is_pair_blocked(current_user_id, rm.user_id)
        and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
        and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id)
        and not exists (
          select 1 from public.interests i where i.room_id = p_room_id
            and ((i.from_user_id = current_user_id and i.to_user_id = rm.user_id)
              or (i.from_user_id = rm.user_id and i.to_user_id = current_user_id))
        )
    ), ranked as (
      select ce.candidate_id,
        row_number() over (
          order by floor((ce.delivered_count + ce.pending_count)::numeric / 2),
                   random(), ce.delivered_count + ce.pending_count, ce.candidate_id
        )::integer as row_position
      from candidate_exposure ce
    )
    select active_batch.id, p_room_id, current_user_id, ranked.candidate_id,
           max_position + ranked.row_position
    from ranked where ranked.row_position <= fill_total
    order by ranked.row_position;
  end if;

  select count(*)::integer into valid_total from public.explore_items ei
  where ei.batch_id = active_batch.id and ei.invalidated_at is null;
  select count(*)::integer into used_total from public.interests i
  where i.explore_batch_id = active_batch.id and i.from_user_id = current_user_id;
  update public.explore_batches eb
  set interest_budget = greatest(used_total, private.adaptive_interest_budget(valid_total))
  where eb.id = active_batch.id returning * into active_batch;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ei.id, 'position', ei.position, 'first_seen_at', ei.first_seen_at,
    'action', ei.action, 'candidate_id', ei.candidate_id,
    'display_name', p.display_name, 'avatar_path', p.avatar_path
  ) order by ei.position), '[]'::jsonb)
  into item_payload
  from public.explore_items ei join public.profiles p on p.id = ei.candidate_id
  where ei.batch_id = active_batch.id and ei.viewer_id = current_user_id
    and ei.invalidated_at is null
    and not public.is_pair_blocked(current_user_id, ei.candidate_id);

  state_payload := public.explore_state(p_room_id);
  return state_payload || jsonb_build_object('items', item_payload);
end;
$$;

create or replace function private.complete_explore_batch_if_finished(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare database_now timestamptz := clock_timestamp();
begin
  if exists (
    select 1 from public.explore_items ei
    where ei.batch_id = p_batch_id and ei.invalidated_at is null
  ) and not exists (
    select 1 from public.explore_items ei
    where ei.batch_id = p_batch_id and ei.invalidated_at is null and ei.action is null
  ) then
    update public.explore_batches eb
    set completed_at = coalesce(eb.completed_at, database_now),
        cooldown_until = coalesce(eb.cooldown_until, database_now + interval '15 minutes')
    where eb.id = p_batch_id and eb.completed_at is null;
  end if;
end;
$$;

create or replace function public.mark_explore_item_seen(p_explore_item_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.explore_items;
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.explore_items ei
  where ei.id = p_explore_item_id and ei.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Explore item not found'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  if not private.is_discovery_eligible(target_item.room_id, target_item.candidate_id, database_now) then
    update public.explore_items set invalidated_at = database_now
    where id = target_item.id and first_seen_at is null;
    raise exception 'This person is no longer available';
  end if;
  update public.explore_items set first_seen_at = coalesce(first_seen_at, database_now)
  where id = target_item.id returning first_seen_at into database_now;
  return database_now;
end;
$$;

create or replace function public.pass_explore_item(p_explore_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); target_item public.explore_items;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.explore_items ei
  where ei.id = p_explore_item_id and ei.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Explore item not found'; end if;
  if target_item.first_seen_at is null then raise exception 'Show the card before continuing'; end if;
  if target_item.action = 'interested' then raise exception 'Interest already sent'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, clock_timestamp()) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  update public.explore_items set action = 'passed' where id = target_item.id and action is null;
  perform private.complete_explore_batch_if_finished(target_item.batch_id);
end;
$$;

create or replace function public.send_explore_interest(p_explore_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.explore_items;
  target_batch public.explore_batches;
  used_budget integer;
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item from public.explore_items ei
  where ei.id = p_explore_item_id and ei.viewer_id = current_user_id for update;
  if target_item.id is null or target_item.invalidated_at is not null then raise exception 'Explore item not found'; end if;
  select * into target_batch from public.explore_batches eb where eb.id = target_item.batch_id for update;
  perform pg_advisory_xact_lock(hashtext(current_user_id::text), hashtext(target_item.batch_id::text));
  if target_item.first_seen_at is null then raise exception 'Show the card before sending Interest'; end if;
  if target_item.action is not null then raise exception 'This card was already handled'; end if;
  if not private.is_discovery_eligible(target_item.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  if not private.is_discovery_eligible(target_item.room_id, target_item.candidate_id, database_now)
     or public.is_pair_blocked(current_user_id, target_item.candidate_id) then
    raise exception 'This interaction is unavailable';
  end if;
  if exists (
    select 1 from public.interests i where i.room_id = target_item.room_id
      and ((i.from_user_id = current_user_id and i.to_user_id = target_item.candidate_id)
        or (i.from_user_id = target_item.candidate_id and i.to_user_id = current_user_id))
  ) then raise exception 'Interest already sent to this person'; end if;

  select count(*)::integer into used_budget from public.interests i
  where i.explore_batch_id = target_batch.id and i.from_user_id = current_user_id;
  if used_budget >= target_batch.interest_budget then raise exception 'No Interests left in this Explore'; end if;
  insert into public.interests (
    room_id, explore_batch_id, explore_item_id, from_user_id, to_user_id
  ) values (
    target_item.room_id, target_item.batch_id, target_item.id,
    current_user_id, target_item.candidate_id
  );
  update public.explore_items set action = 'interested' where id = target_item.id;
  perform private.complete_explore_batch_if_finished(target_item.batch_id);
  return target_batch.interest_budget - used_budget - 1;
end;
$$;

create or replace function public.respond_to_interest(p_interest_id uuid, p_interested boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_interest public.interests;
  first_user uuid;
  second_user uuid;
  resolved_match_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_interested is null then raise exception 'Interest response is required'; end if;
  select * into target_interest from public.interests i
  where i.id = p_interest_id and i.to_user_id = current_user_id for update;
  if target_interest.id is null then raise exception 'Incoming Interest not found'; end if;
  if target_interest.status <> 'pending' then
    if target_interest.status = 'accepted' and p_interested then return target_interest.match_id; end if;
    if target_interest.status = 'declined' and not p_interested then return null; end if;
    raise exception 'This Interest was already processed';
  end if;
  if not exists (select 1 from public.rooms r where r.id = target_interest.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  if exists (
    select 1 from public.room_members rm
    where rm.room_id = target_interest.room_id
      and rm.user_id in (current_user_id, target_interest.from_user_id)
      and (not rm.discovery_enabled or rm.left_at is not null)
  ) then raise exception 'Rejoin the event to respond'; end if;
  if public.is_pair_blocked(current_user_id, target_interest.from_user_id) then
    raise exception 'This interaction is unavailable';
  end if;
  if not p_interested then
    update public.interests set status = 'declined', responded_at = clock_timestamp()
    where id = target_interest.id;
    return null;
  end if;
  if target_interest.from_user_id::text < current_user_id::text then
    first_user := target_interest.from_user_id; second_user := current_user_id;
  else first_user := current_user_id; second_user := target_interest.from_user_id; end if;
  insert into public.matches (room_id, user_a_id, user_b_id)
  values (target_interest.room_id, first_user, second_user)
  on conflict (room_id, user_a_id, user_b_id) do nothing;
  select m.id into resolved_match_id from public.matches m
  where m.room_id = target_interest.room_id and m.user_a_id = first_user and m.user_b_id = second_user;
  update public.interests set status = 'accepted', responded_at = clock_timestamp(), match_id = resolved_match_id
  where room_id = target_interest.room_id and status = 'pending'
    and ((from_user_id = first_user and to_user_id = second_user)
      or (from_user_id = second_user and to_user_id = first_user));
  return resolved_match_id;
end;
$$;

create or replace function private.invalidate_explore_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_batches uuid[];
  affected_batch uuid;
begin
  select array_agg(distinct ei.batch_id) into affected_batches
  from public.explore_items ei
  where ei.action is null and ei.invalidated_at is null
    and ((ei.viewer_id = new.blocker_id and ei.candidate_id = new.blocked_id)
      or (ei.viewer_id = new.blocked_id and ei.candidate_id = new.blocker_id));
  update public.explore_items ei set action = 'passed'
  where ei.action is null and ei.invalidated_at is null
    and ((ei.viewer_id = new.blocker_id and ei.candidate_id = new.blocked_id)
      or (ei.viewer_id = new.blocked_id and ei.candidate_id = new.blocker_id));
  foreach affected_batch in array coalesce(affected_batches, array[]::uuid[]) loop
    perform private.complete_explore_batch_if_finished(affected_batch);
  end loop;
  return new;
end;
$$;

drop trigger if exists blocks_invalidate_explore on public.blocks;
create trigger blocks_invalidate_explore
after insert or update on public.blocks
for each row execute function private.invalidate_explore_on_block();

create or replace function public.can_current_user_read_avatar(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null and (
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
      where i.status = 'pending' and i.to_user_id = (select auth.uid()) and i.from_user_id = target
        and not public.is_pair_blocked(i.from_user_id, i.to_user_id)
    )
    or exists (
      select 1 from public.matches m
      where ((m.user_a_id = (select auth.uid()) and m.user_b_id = target)
          or (m.user_b_id = (select auth.uid()) and m.user_a_id = target))
        and not public.is_pair_blocked(m.user_a_id, m.user_b_id)
    )
  );
$$;

alter policy avatars_read_owner_or_shared_room on storage.objects
using (
  bucket_id = 'avatars'
  and public.can_current_user_read_avatar(
    public.safe_uuid((storage.foldername(name))[1])
  )
);

alter function public.room_analytics(uuid) rename to room_analytics_sprint5_internal;
revoke all on function public.room_analytics_sprint5_internal(uuid) from public, anon, authenticated;

create or replace function public.room_analytics(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result jsonb;
  database_now timestamptz := clock_timestamp();
  recent_total integer := 0;
  eligible_total integer := 0;
  explore_claimed integer := 0;
  explore_completed integer := 0;
  explore_seen integer := 0;
  explore_interests integer := 0;
  explore_completion_rate numeric;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'Permanent organizer account required';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room_id and r.organizer_id = current_user_id) then
    raise exception 'Organizer access required';
  end if;

  result := public.room_analytics_sprint5_internal(p_room_id);
  select count(*) filter (
      where rm.is_active and rm.discovery_enabled and rm.left_at is null
        and rm.last_seen_at >= database_now - interval '10 minutes'
    )::integer,
    count(*) filter (
      where rm.is_active and rm.discovery_enabled and rm.left_at is null
        and rm.last_seen_at >= database_now - interval '60 minutes'
    )::integer
  into recent_total, eligible_total
  from public.room_members rm where rm.room_id = p_room_id;

  select count(*)::integer, count(*) filter (where eb.completed_at is not null)::integer
  into explore_claimed, explore_completed from public.explore_batches eb where eb.room_id = p_room_id;
  select count(*) filter (where ei.first_seen_at is not null)::integer
  into explore_seen from public.explore_items ei where ei.room_id = p_room_id;
  select count(*)::integer into explore_interests from public.interests i
  where i.room_id = p_room_id and i.explore_item_id is not null;
  explore_completion_rate := case when explore_claimed = 0 then null
    else round(explore_completed::numeric * 100 / explore_claimed, 1) end;

  result := jsonb_set(result, '{summary,active_memberships}', to_jsonb(recent_total), true);
  result := jsonb_set(result, '{summary,discovery_eligible_memberships}', to_jsonb(eligible_total), true);
  result := jsonb_set(result, '{summary,explore_batches_claimed}', to_jsonb(explore_claimed), true);
  result := jsonb_set(result, '{summary,explore_batches_completed}', to_jsonb(explore_completed), true);
  result := jsonb_set(result, '{summary,explore_cards_seen}', to_jsonb(explore_seen), true);
  result := jsonb_set(result, '{summary,explore_interests_sent}', to_jsonb(explore_interests), true);
  result := result || jsonb_build_object(
    'presence_model', jsonb_build_object(
      'heartbeat_seconds', 60,
      'recent_active_timeout_seconds', 600,
      'discovery_eligible_timeout_seconds', 3600,
      'definition', 'server heartbeat plus explicit discovery state'
    ),
    'explore', jsonb_build_object(
      'batches_claimed', explore_claimed,
      'batches_completed', explore_completed,
      'cards_seen', explore_seen,
      'interests_sent', explore_interests,
      'completion_rate', explore_completion_rate
    )
  );
  return result;
end;
$$;

revoke all on function private.adaptive_interest_budget(integer) from public, anon, authenticated;
revoke all on function private.explore_target_size(integer) from public, anon, authenticated;
revoke all on function private.is_recently_active(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.is_discovery_eligible(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.viewer_has_seen_candidate(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.viewer_has_pending_candidate(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.discovery_delivered_count(uuid, uuid) from public, anon, authenticated;
revoke all on function private.discovery_pending_count(uuid, uuid) from public, anon, authenticated;
revoke all on function private.invalidate_stale_discovery_assignments(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.complete_explore_batch_if_finished(uuid) from public, anon, authenticated;
revoke all on function private.invalidate_explore_on_block() from public, anon, authenticated;

revoke all on function public.rejoin_room_presence(uuid) from public, anon, authenticated;
grant execute on function public.rejoin_room_presence(uuid) to authenticated;
revoke all on function public.room_presence_state(uuid) from public, anon, authenticated;
grant execute on function public.room_presence_state(uuid) to authenticated;
revoke all on function public.explore_state(uuid) from public, anon, authenticated;
grant execute on function public.explore_state(uuid) to authenticated;
revoke all on function public.claim_explore_batch(uuid) from public, anon, authenticated;
grant execute on function public.claim_explore_batch(uuid) to authenticated;
revoke all on function public.mark_explore_item_seen(uuid) from public, anon, authenticated;
grant execute on function public.mark_explore_item_seen(uuid) to authenticated;
revoke all on function public.pass_explore_item(uuid) from public, anon, authenticated;
grant execute on function public.pass_explore_item(uuid) to authenticated;
revoke all on function public.send_explore_interest(uuid) from public, anon, authenticated;
grant execute on function public.send_explore_interest(uuid) to authenticated;
revoke all on function public.can_current_user_read_avatar(uuid) from public, anon, authenticated;
grant execute on function public.can_current_user_read_avatar(uuid) to authenticated;

revoke all on function public.join_room_by_code(text) from public, anon, authenticated;
grant execute on function public.join_room_by_code(text) to authenticated;
revoke all on function public.heartbeat_room_presence(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_room_presence(uuid) to authenticated;
revoke all on function public.leave_room_presence(uuid) from public, anon, authenticated;
grant execute on function public.leave_room_presence(uuid) to authenticated;
revoke all on function public.organizer_room_presence_counts() from public, anon, authenticated;
grant execute on function public.organizer_room_presence_counts() to authenticated;
revoke all on function public.room_wall_profiles(uuid, integer) from public, anon, authenticated;
grant execute on function public.room_wall_profiles(uuid, integer) to authenticated;
revoke all on function public.room_drop_state(uuid) from public, anon, authenticated;
grant execute on function public.room_drop_state(uuid) to authenticated;
revoke all on function public.claim_your_drop(uuid) from public, anon, authenticated;
grant execute on function public.claim_your_drop(uuid) to authenticated;
revoke all on function public.mark_drop_item_seen(uuid) from public, anon, authenticated;
grant execute on function public.mark_drop_item_seen(uuid) to authenticated;
revoke all on function public.pass_drop_item(uuid) from public, anon, authenticated;
grant execute on function public.pass_drop_item(uuid) to authenticated;
revoke all on function public.send_interest(uuid) from public, anon, authenticated;
grant execute on function public.send_interest(uuid) to authenticated;
revoke all on function public.respond_to_interest(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_to_interest(uuid, boolean) to authenticated;
revoke all on function public.room_analytics(uuid) from public, anon, authenticated;
grant execute on function public.room_analytics(uuid) to authenticated;
