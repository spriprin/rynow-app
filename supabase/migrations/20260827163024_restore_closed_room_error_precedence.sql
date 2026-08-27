-- Restore the established distinction between a closed Room and an eligible
-- participant who explicitly left an otherwise-open Room. Discovery remains
-- denied in both cases; only the safe, user-facing error precedence changes.

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
  if not exists (
    select 1 from public.rooms r where r.id = target_item.room_id and r.status = 'open'
  ) then
    raise exception 'This Room has ended.';
  end if;
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

revoke all on function public.claim_your_drop(uuid) from public, anon, authenticated;
grant execute on function public.claim_your_drop(uuid) to authenticated;
revoke all on function public.send_interest(uuid) from public, anon, authenticated;
grant execute on function public.send_interest(uuid) to authenticated;
