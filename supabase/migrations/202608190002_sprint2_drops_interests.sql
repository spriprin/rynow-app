-- HERE Sprint 2: Drops, persistent Your Drop assignments, Fair Exposure and visible Interests.
-- Additive migration only. Sprint 1 foundation tables and policies remain unchanged.

create table if not exists public.drops (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sequence_number integer not null,
  scheduled_at timestamptz not null,
  opened_at timestamptz,
  drop_size integer not null default 10,
  min_unlock_count integer not null default 6,
  interest_budget integer not null default 3,
  created_at timestamptz not null default now(),
  constraint drops_room_sequence_unique unique (room_id, sequence_number),
  constraint drops_id_room_unique unique (id, room_id),
  constraint valid_drop_size check (drop_size between 1 and 20),
  constraint valid_min_unlock_count check (
    min_unlock_count between 1 and drop_size
  ),
  constraint valid_interest_budget check (
    interest_budget between 0 and drop_size
  )
);

create table if not exists public.drop_items (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null,
  room_id uuid not null,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  first_seen_at timestamptz,
  action text,
  constraint drop_items_drop_room_fk
    foreign key (drop_id, room_id)
    references public.drops(id, room_id) on delete cascade,
  constraint drop_items_viewer_membership_fk
    foreign key (room_id, viewer_id)
    references public.room_members(room_id, user_id) on delete cascade,
  constraint drop_items_candidate_membership_fk
    foreign key (room_id, candidate_id)
    references public.room_members(room_id, user_id) on delete cascade,
  constraint drop_item_not_self check (viewer_id <> candidate_id),
  constraint valid_drop_item_position check (position between 1 and 20),
  constraint valid_drop_item_action check (
    action is null or action in ('passed', 'interested')
  ),
  constraint drop_items_viewer_candidate_unique
    unique (drop_id, viewer_id, candidate_id),
  constraint drop_items_viewer_position_unique
    unique (drop_id, viewer_id, position),
  constraint drop_items_identity_unique
    unique (id, drop_id, room_id, viewer_id, candidate_id)
);

create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  drop_id uuid not null,
  drop_item_id uuid not null,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint interests_assigned_item_fk
    foreign key (drop_item_id, drop_id, room_id, from_user_id, to_user_id)
    references public.drop_items(id, drop_id, room_id, viewer_id, candidate_id)
    on delete cascade,
  constraint interest_not_self check (from_user_id <> to_user_id),
  constraint interests_one_per_item unique (drop_item_id),
  constraint interests_one_pair_per_room unique (room_id, from_user_id, to_user_id)
);

create index if not exists drops_room_schedule_idx
  on public.drops (room_id, scheduled_at, sequence_number);
create index if not exists drop_items_viewer_progress_idx
  on public.drop_items (room_id, viewer_id, drop_id, action, position);
create index if not exists drop_items_candidate_exposure_idx
  on public.drop_items (room_id, candidate_id, first_seen_at);
create index if not exists drop_items_pending_idx
  on public.drop_items (drop_id, candidate_id)
  where first_seen_at is null;
create index if not exists interests_recipient_room_idx
  on public.interests (to_user_id, room_id, created_at desc);
create index if not exists interests_sender_drop_idx
  on public.interests (from_user_id, drop_id);

create or replace function public.require_room_organizer(p_room_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'Permanent organizer account required';
  end if;
  if not exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.organizer_id = auth.uid()
  ) then
    raise exception 'Organizer access required';
  end if;
end;
$$;

create or replace function public.create_room_drop(
  p_room_id uuid,
  p_scheduled_at timestamptz,
  p_drop_size integer default 10,
  p_min_unlock_count integer default 6,
  p_interest_budget integer default 3
)
returns public.drops
language plpgsql
security definer
set search_path = public
as $$
declare
  next_sequence integer;
  created_drop public.drops;
begin
  perform public.require_room_organizer(p_room_id);

  -- Serialize sequence generation and reject Drops for ended Rooms.
  perform 1 from public.rooms r where r.id = p_room_id and r.status <> 'closed' for update;
  if not found then raise exception 'This Room has ended.'; end if;

  if p_scheduled_at is null then raise exception 'Drop time is required'; end if;
  if p_drop_size not between 1 and 20 then raise exception 'Drop size must be between 1 and 20'; end if;
  if p_min_unlock_count not between 1 and p_drop_size then raise exception 'Invalid minimum unlock count'; end if;
  if p_interest_budget not between 0 and p_drop_size then raise exception 'Invalid Interest budget'; end if;

  select coalesce(max(d.sequence_number), 0) + 1
  into next_sequence
  from public.drops d
  where d.room_id = p_room_id;

  insert into public.drops (
    room_id, sequence_number, scheduled_at, drop_size,
    min_unlock_count, interest_budget
  ) values (
    p_room_id, next_sequence, p_scheduled_at, p_drop_size,
    p_min_unlock_count, p_interest_budget
  )
  returning * into created_drop;

  return created_drop;
end;
$$;

create or replace function public.delete_future_drop(p_drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_drop public.drops;
begin
  select * into target_drop from public.drops d where d.id = p_drop_id for update;
  if target_drop.id is null then raise exception 'Drop not found'; end if;
  perform public.require_room_organizer(target_drop.room_id);
  if target_drop.opened_at is not null or target_drop.scheduled_at <= clock_timestamp() then
    raise exception 'Only future Drops can be deleted';
  end if;
  if exists (select 1 from public.drop_items di where di.drop_id = target_drop.id) then
    raise exception 'A claimed Drop cannot be deleted';
  end if;
  delete from public.drops where id = target_drop.id;
end;
$$;

create or replace function public.open_drop_now(p_drop_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  target_drop public.drops;
  opened_time timestamptz;
begin
  select * into target_drop from public.drops d where d.id = p_drop_id for update;
  if target_drop.id is null then raise exception 'Drop not found'; end if;
  perform public.require_room_organizer(target_drop.room_id);
  if not exists (
    select 1 from public.rooms r where r.id = target_drop.room_id and r.status = 'open'
  ) then
    raise exception 'Room must be open';
  end if;

  update public.drops
  set opened_at = coalesce(opened_at, clock_timestamp())
  where id = target_drop.id
  returning opened_at into opened_time;
  return opened_time;
end;
$$;

create or replace function public.room_drop_state(p_room_id uuid)
returns table (
  drop_id uuid,
  sequence_number integer,
  scheduled_at timestamptz,
  effective_open_at timestamptz,
  drop_size integer,
  min_unlock_count integer,
  interest_budget integer,
  assigned_count integer,
  remaining_count integer,
  interests_used integer,
  eligible_count integer,
  active_candidate_count integer,
  next_scheduled_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = public
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
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, current_user_id) then
    raise exception 'Room access required';
  end if;

  -- Preserve an unfinished claimed Drop even after a newer Drop opens.
  select d.* into current_drop
  from public.drops d
  where d.room_id = p_room_id
    and coalesce(d.opened_at, d.scheduled_at) <= database_now
    and exists (
      select 1 from public.drop_items di
      where di.drop_id = d.id
        and di.viewer_id = current_user_id
        and di.action is null
    )
  order by coalesce(d.opened_at, d.scheduled_at) desc, d.sequence_number desc
  limit 1;

  if current_drop.id is null then
    select d.* into current_drop
    from public.drops d
    where d.room_id = p_room_id
      and coalesce(d.opened_at, d.scheduled_at) <= database_now
    order by coalesce(d.opened_at, d.scheduled_at) desc, d.sequence_number desc
    limit 1;
  end if;

  select min(d.scheduled_at) into next_time
  from public.drops d
  where d.room_id = p_room_id
    and d.opened_at is null
    and d.scheduled_at > database_now;

  if current_drop.id is not null then
    select count(*)::integer,
           count(*) filter (where di.action is null)::integer
    into assigned_total, remaining_total
    from public.drop_items di
    where di.drop_id = current_drop.id and di.viewer_id = current_user_id;

    select count(*)::integer into used_total
    from public.interests i
    where i.drop_id = current_drop.id and i.from_user_id = current_user_id;

    select count(*)::integer into active_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = p_room_id
      and rm.is_active = true
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null;

    select count(*)::integer into eligible_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = p_room_id
      and rm.is_active = true
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and not exists (
        select 1 from public.drop_items seen
        where seen.room_id = p_room_id
          and seen.viewer_id = current_user_id
          and seen.candidate_id = rm.user_id
          and seen.first_seen_at is not null
      );
  end if;

  return query select
    current_drop.id,
    current_drop.sequence_number,
    current_drop.scheduled_at,
    coalesce(current_drop.opened_at, current_drop.scheduled_at),
    current_drop.drop_size,
    current_drop.min_unlock_count,
    current_drop.interest_budget,
    assigned_total,
    remaining_total,
    used_total,
    eligible_total,
    active_total,
    next_time,
    database_now;
end;
$$;

create or replace function public.claim_your_drop(p_drop_id uuid)
returns table (
  id uuid,
  item_position integer,
  first_seen_at timestamptz,
  action text,
  candidate_id uuid,
  display_name text,
  avatar_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_drop public.drops;
  eligible_total integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  -- Serializing claims for a Drop keeps pending reservations useful under load.
  select * into target_drop from public.drops d where d.id = p_drop_id for update;
  if target_drop.id is null then raise exception 'Drop not found'; end if;
  if coalesce(target_drop.opened_at, target_drop.scheduled_at) > clock_timestamp() then
    raise exception 'This Drop is not open yet';
  end if;
  if not exists (
    select 1 from public.rooms r
    where r.id = target_drop.room_id and r.status = 'open'
  ) then
    raise exception 'This Room has ended.';
  end if;
  if not public.is_room_member(target_drop.room_id, current_user_id) then
    raise exception 'Room access required';
  end if;

  if not exists (
    select 1 from public.drop_items di
    where di.drop_id = target_drop.id and di.viewer_id = current_user_id
  ) then
    select count(*)::integer into eligible_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = target_drop.room_id
      and rm.is_active = true
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and not exists (
        select 1 from public.drop_items seen
        where seen.room_id = target_drop.room_id
          and seen.viewer_id = current_user_id
          and seen.candidate_id = rm.user_id
          and seen.first_seen_at is not null
      );

    if eligible_total < target_drop.min_unlock_count then
      return;
    end if;

    insert into public.drop_items (
      drop_id, room_id, viewer_id, candidate_id, position
    )
    with candidate_exposure as (
      select
        rm.user_id as candidate_id,
        (
          select count(*)::integer
          from public.drop_items delivered
          where delivered.room_id = target_drop.room_id
            and delivered.candidate_id = rm.user_id
            and delivered.first_seen_at is not null
        ) as delivered_count,
        (
          select count(*)::integer
          from public.drop_items pending
          where pending.drop_id = target_drop.id
            and pending.candidate_id = rm.user_id
            and pending.first_seen_at is null
        ) as pending_count
      from public.room_members rm
      join public.profiles p on p.id = rm.user_id
      where rm.room_id = target_drop.room_id
        and rm.is_active = true
        and rm.user_id <> current_user_id
        and p.age_confirmed_18 = true
        and p.avatar_path is not null
        and not exists (
          select 1 from public.drop_items seen
          where seen.room_id = target_drop.room_id
            and seen.viewer_id = current_user_id
            and seen.candidate_id = rm.user_id
            and seen.first_seen_at is not null
        )
    ), ranked as (
      select
        ce.candidate_id,
        row_number() over (
          order by
            floor((ce.delivered_count + ce.pending_count)::numeric / 2),
            random(),
            ce.delivered_count + ce.pending_count,
            ce.candidate_id
        )::integer as position
      from candidate_exposure ce
    )
    select target_drop.id, target_drop.room_id, current_user_id,
           ranked.candidate_id, ranked.position
    from ranked
    where ranked.position <= target_drop.drop_size
    order by ranked.position;
  end if;

  return query
  select di.id, di.position as item_position, di.first_seen_at, di.action,
         di.candidate_id, p.display_name, p.avatar_path
  from public.drop_items di
  join public.profiles p on p.id = di.candidate_id
  where di.drop_id = target_drop.id and di.viewer_id = current_user_id
  order by di.position;
end;
$$;

create or replace function public.mark_drop_item_seen(p_drop_item_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.drop_items;
  seen_time timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item
  from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id
  for update;
  if target_item.id is null then raise exception 'Drop item not found'; end if;
  if not public.is_room_member(target_item.room_id, current_user_id) then
    raise exception 'Room access required';
  end if;
  if not exists (select 1 from public.rooms r where r.id = target_item.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;

  update public.drop_items
  set first_seen_at = coalesce(first_seen_at, clock_timestamp())
  where id = target_item.id
  returning first_seen_at into seen_time;
  return seen_time;
end;
$$;

create or replace function public.pass_drop_item(p_drop_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.drop_items;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item
  from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id
  for update;
  if target_item.id is null then raise exception 'Drop item not found'; end if;
  if target_item.first_seen_at is null then raise exception 'Show the card before continuing'; end if;
  if target_item.action = 'interested' then raise exception 'Interest already sent'; end if;
  if not public.is_room_member(target_item.room_id, current_user_id) then
    raise exception 'Room access required';
  end if;
  if not exists (select 1 from public.rooms r where r.id = target_item.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  update public.drop_items set action = 'passed'
  where id = target_item.id and action is null;
end;
$$;

create or replace function public.send_interest(p_drop_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_item public.drop_items;
  allowed_budget integer;
  used_budget integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_item
  from public.drop_items di
  where di.id = p_drop_item_id and di.viewer_id = current_user_id
  for update;
  if target_item.id is null then raise exception 'Drop item not found'; end if;

  -- Prevent parallel requests from bypassing one viewer's Drop budget.
  perform pg_advisory_xact_lock(
    hashtext(current_user_id::text),
    hashtext(target_item.drop_id::text)
  );

  if target_item.first_seen_at is null then raise exception 'Show the card before sending Interest'; end if;
  if target_item.action is not null then raise exception 'This card was already handled'; end if;
  if not exists (select 1 from public.rooms r where r.id = target_item.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  if not public.is_room_member(target_item.room_id, current_user_id)
     or not public.is_room_member(target_item.room_id, target_item.candidate_id) then
    raise exception 'Both people must be active in this Room';
  end if;
  if exists (
    select 1 from public.interests i
    where i.room_id = target_item.room_id
      and i.from_user_id = current_user_id
      and i.to_user_id = target_item.candidate_id
  ) then
    raise exception 'Interest already sent to this person';
  end if;

  select d.interest_budget into allowed_budget
  from public.drops d where d.id = target_item.drop_id;
  select count(*)::integer into used_budget
  from public.interests i
  where i.drop_id = target_item.drop_id and i.from_user_id = current_user_id;
  if used_budget >= allowed_budget then raise exception 'No Interests left in this Drop'; end if;

  insert into public.interests (
    room_id, drop_id, drop_item_id, from_user_id, to_user_id
  ) values (
    target_item.room_id, target_item.drop_id, target_item.id,
    current_user_id, target_item.candidate_id
  );
  update public.drop_items set action = 'interested' where id = target_item.id;

  return allowed_budget - used_budget - 1;
end;
$$;

create or replace function public.interested_in_you(p_room_id uuid)
returns table (
  interest_id uuid,
  from_user_id uuid,
  display_name text,
  avatar_path text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, auth.uid()) then
    raise exception 'Room access required';
  end if;

  return query
  select i.id, i.from_user_id, p.display_name, p.avatar_path, i.created_at
  from public.interests i
  join public.profiles p on p.id = i.from_user_id
  where i.room_id = p_room_id
    and i.to_user_id = auth.uid()
  order by i.created_at desc
  limit 50;
end;
$$;

create or replace function public.sent_interests(p_room_id uuid)
returns table (
  interest_id uuid,
  to_user_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, auth.uid()) then
    raise exception 'Room access required';
  end if;

  return query
  select i.id, i.to_user_id, i.created_at
  from public.interests i
  where i.room_id = p_room_id
    and i.from_user_id = auth.uid()
  order by i.created_at desc;
end;
$$;

alter table public.drops enable row level security;
alter table public.drop_items enable row level security;
alter table public.interests enable row level security;

drop policy if exists "drops_read_owner_or_member" on public.drops;
create policy "drops_read_owner_or_member"
on public.drops for select
to authenticated
using (
  public.is_room_member(room_id, (select auth.uid()))
  or exists (
    select 1 from public.rooms r
    where r.id = drops.room_id and r.organizer_id = (select auth.uid())
  )
);

-- drop_items and interests intentionally have no direct table policies.
-- Narrow SECURITY DEFINER RPCs expose only the authenticated viewer's assigned
-- cards, the authenticated recipient's incoming Interests, or the sender's own
-- sent Interest records. Candidates cannot inspect who received their profile.
revoke all on public.drops from anon, authenticated;
revoke all on public.drop_items from anon, authenticated;
revoke all on public.interests from anon, authenticated;
grant select on public.drops to authenticated;

revoke all on function public.require_room_organizer(uuid) from public;
revoke all on function public.create_room_drop(uuid, timestamptz, integer, integer, integer) from public;
revoke all on function public.delete_future_drop(uuid) from public;
revoke all on function public.open_drop_now(uuid) from public;
revoke all on function public.room_drop_state(uuid) from public;
revoke all on function public.claim_your_drop(uuid) from public;
revoke all on function public.mark_drop_item_seen(uuid) from public;
revoke all on function public.pass_drop_item(uuid) from public;
revoke all on function public.send_interest(uuid) from public;
revoke all on function public.interested_in_you(uuid) from public;
revoke all on function public.sent_interests(uuid) from public;

grant execute on function public.create_room_drop(uuid, timestamptz, integer, integer, integer) to authenticated;
grant execute on function public.delete_future_drop(uuid) to authenticated;
grant execute on function public.open_drop_now(uuid) to authenticated;
grant execute on function public.room_drop_state(uuid) to authenticated;
grant execute on function public.claim_your_drop(uuid) to authenticated;
grant execute on function public.mark_drop_item_seen(uuid) to authenticated;
grant execute on function public.pass_drop_item(uuid) to authenticated;
grant execute on function public.send_interest(uuid) to authenticated;
grant execute on function public.interested_in_you(uuid) to authenticated;
grant execute on function public.sent_interests(uuid) to authenticated;
