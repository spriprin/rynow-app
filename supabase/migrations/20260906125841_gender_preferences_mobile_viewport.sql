-- Production migration 20260906125841: explicit profile gender and a viewer-side
-- discovery preference. Existing assignments are intentionally not rewritten;
-- the preference is applied only when a new Explore/Drop item is selected.

alter table public.profiles
  add column gender text,
  add column discovery_preference text;

alter table public.profiles
  add constraint profiles_gender_values
    check (gender is null or gender in ('male', 'female', 'prefer_not_to_say')) not valid,
  add constraint profiles_discovery_preference_values
    check (discovery_preference is null or discovery_preference in ('male', 'female', 'everyone')) not valid;

alter table public.profiles validate constraint profiles_gender_values;
alter table public.profiles validate constraint profiles_discovery_preference_values;

comment on column public.profiles.gender is
  'Self-declared profile gender: male, female, or prefer_not_to_say.';
comment on column public.profiles.discovery_preference is
  'Viewer-side discovery filter: male, female, or everyone. It is not a reciprocal orientation model.';

create or replace function private.has_complete_discovery_profile(p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.gender is not null
      and p.discovery_preference is not null
  );
$$;

create or replace function private.viewer_accepts_candidate(
  p_viewer_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select
      viewer.gender is not null
      and viewer.discovery_preference is not null
      and candidate.gender is not null
      and candidate.discovery_preference is not null
      and (
        viewer.discovery_preference = 'everyone'
        or viewer.discovery_preference = candidate.gender
      )
    from public.profiles viewer
    cross join public.profiles candidate
    where viewer.id = p_viewer_id
      and candidate.id = p_candidate_id
  ), false);
$$;

revoke all on function private.has_complete_discovery_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.viewer_accepts_candidate(uuid, uuid)
  from public, anon, authenticated, service_role;

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
      and p.gender is not null
      and p.discovery_preference is not null
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
      and private.viewer_accepts_candidate(current_user_id, rm.user_id)
      and not public.is_pair_blocked(current_user_id, rm.user_id);

    select count(*)::integer into eligible_total
    from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id <> current_user_id
      and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
      and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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
  if not exists (
    select 1 from public.rooms r where r.id = target_drop.room_id and r.status = 'open'
  ) then
    raise exception 'This Room has ended.';
  end if;
  if not private.is_discovery_eligible(target_drop.room_id, current_user_id, database_now) then
    raise exception 'Rejoin the event to continue discovery';
  end if;
  if not private.has_complete_discovery_profile(current_user_id) then
    raise exception 'Complete your profile preferences to continue discovery';
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
    and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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
        and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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
        and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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
  if not private.has_complete_discovery_profile(current_user_id) then
    raise exception 'Complete your profile preferences to continue discovery';
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
        and private.viewer_accepts_candidate(current_user_id, rm.user_id)
        and not public.is_pair_blocked(current_user_id, rm.user_id)
        and not private.viewer_has_seen_candidate(p_room_id, current_user_id, rm.user_id)
        and not private.viewer_has_pending_candidate(p_room_id, current_user_id, rm.user_id);
      if new_total < 3 then return public.explore_state(p_room_id); end if;
    end if;

    select count(*)::integer into eligible_total from public.room_members rm
    where rm.room_id = p_room_id and rm.user_id <> current_user_id
      and private.is_discovery_eligible(p_room_id, rm.user_id, database_now)
      and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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
        and private.viewer_accepts_candidate(current_user_id, rm.user_id)
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

revoke all on function public.join_room_by_code(text) from public, anon, authenticated;
grant execute on function public.join_room_by_code(text) to authenticated;
revoke all on function public.room_drop_state(uuid) from public, anon, authenticated;
grant execute on function public.room_drop_state(uuid) to authenticated;
revoke all on function public.claim_your_drop(uuid) from public, anon, authenticated;
grant execute on function public.claim_your_drop(uuid) to authenticated;
revoke all on function public.explore_state(uuid) from public, anon, authenticated;
grant execute on function public.explore_state(uuid) to authenticated;
revoke all on function public.claim_explore_batch(uuid) from public, anon, authenticated;
grant execute on function public.claim_explore_batch(uuid) to authenticated;
