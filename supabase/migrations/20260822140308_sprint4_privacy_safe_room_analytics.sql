-- HERE Sprint 4: privacy-safe Room analytics and minimal source instrumentation.
-- No person-level analytics data is exposed to organizers or browser roles.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.drop_claim_states (
  drop_id uuid not null,
  room_id uuid not null,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  first_attempted_at timestamptz not null default clock_timestamp(),
  forming_at timestamptz,
  unlocked_at timestamptz,
  primary key (drop_id, viewer_id),
  constraint drop_claim_states_drop_room_fk
    foreign key (drop_id, room_id)
    references public.drops(id, room_id) on delete cascade,
  constraint drop_claim_states_viewer_membership_fk
    foreign key (room_id, viewer_id)
    references public.room_members(room_id, user_id) on delete cascade,
  constraint drop_claim_state_valid_timestamps check (
    (forming_at is null or forming_at >= first_attempted_at)
    and (unlocked_at is null or unlocked_at >= first_attempted_at)
  )
);

create index drop_claim_states_room_drop_idx
  on private.drop_claim_states (room_id, drop_id);
create index drop_claim_states_room_viewer_idx
  on private.drop_claim_states (room_id, viewer_id);

create table private.interest_opens (
  interest_id uuid primary key references public.interests(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  opened_at timestamptz not null default clock_timestamp()
);

create index interest_opens_room_opened_idx
  on private.interest_opens (room_id, opened_at);

alter table private.drop_claim_states enable row level security;
alter table private.interest_opens enable row level security;
revoke all on private.drop_claim_states from public, anon, authenticated;
revoke all on private.interest_opens from public, anon, authenticated;

alter table public.blocks
  add column if not exists room_id uuid,
  add column if not exists match_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocks_room_id_fkey'
      and conrelid = 'public.blocks'::regclass
  ) then
    alter table public.blocks
      add constraint blocks_room_id_fkey
      foreign key (room_id) references public.rooms(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocks_match_id_fkey'
      and conrelid = 'public.blocks'::regclass
  ) then
    alter table public.blocks
      add constraint blocks_match_id_fkey
      foreign key (match_id) references public.matches(id) on delete set null;
  end if;
end;
$$;

create index if not exists blocks_room_created_idx
  on public.blocks (room_id, created_at) where room_id is not null;
create index if not exists blocks_match_id_idx
  on public.blocks (match_id) where match_id is not null;
create index if not exists reports_room_created_idx
  on public.reports (room_id, created_at) where room_id is not null;
create index if not exists reports_match_id_idx
  on public.reports (match_id) where match_id is not null;

-- Claim instrumentation lives inside the canonical claim path. One viewer + Drop
-- has one row, so retries and concurrent requests cannot inflate any aggregate.
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
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_drop public.drops;
  eligible_total integer;
  instrumentation_now timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into target_drop
  from public.drops d
  where d.id = p_drop_id
  for update;
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

  instrumentation_now := clock_timestamp();
  insert into private.drop_claim_states (
    drop_id, room_id, viewer_id, first_attempted_at
  ) values (
    target_drop.id, target_drop.room_id, current_user_id, instrumentation_now
  )
  on conflict (drop_id, viewer_id) do nothing;

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
      and not public.is_pair_blocked(current_user_id, rm.user_id)
      and not exists (
        select 1 from public.drop_items seen
        where seen.room_id = target_drop.room_id
          and seen.viewer_id = current_user_id
          and seen.candidate_id = rm.user_id
          and seen.first_seen_at is not null
      );

    if eligible_total < target_drop.min_unlock_count then
      update private.drop_claim_states
      set forming_at = coalesce(forming_at, instrumentation_now)
      where drop_id = target_drop.id and viewer_id = current_user_id;
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
        and not public.is_pair_blocked(current_user_id, rm.user_id)
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

  if exists (
    select 1 from public.drop_items di
    where di.drop_id = target_drop.id and di.viewer_id = current_user_id
  ) then
    update private.drop_claim_states
    set unlocked_at = coalesce(unlocked_at, clock_timestamp())
    where drop_id = target_drop.id and viewer_id = current_user_id;
  end if;

  return query
  select di.id, di.position as item_position, di.first_seen_at, di.action,
         di.candidate_id, p.display_name, p.avatar_path
  from public.drop_items di
  join public.profiles p on p.id = di.candidate_id
  where di.drop_id = target_drop.id
    and di.viewer_id = current_user_id
    and not public.is_pair_blocked(current_user_id, di.candidate_id)
  order by di.position;
end;
$$;

create or replace function public.mark_incoming_interest_opened(p_interest_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_interest public.interests;
  first_opened_at timestamptz;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;

  select * into target_interest
  from public.interests i
  where i.id = p_interest_id
    and i.to_user_id = current_user_id
    and i.status = 'pending'
  for update;
  if target_interest.id is null then
    raise exception 'Incoming Interest not found';
  end if;
  if not public.is_room_member(target_interest.room_id, current_user_id) then
    raise exception 'Room access required';
  end if;

  insert into private.interest_opens (
    interest_id, room_id, recipient_id, opened_at
  ) values (
    target_interest.id, target_interest.room_id, current_user_id, clock_timestamp()
  )
  on conflict (interest_id) do nothing;

  select io.opened_at into first_opened_at
  from private.interest_opens io
  where io.interest_id = target_interest.id;
  return first_opened_at;
end;
$$;

create or replace function public.block_user_in_context(
  p_blocked_id uuid,
  p_room_id uuid default null,
  p_match_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
  resolved_room_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_blocked_id is null or p_blocked_id = current_user_id then
    raise exception 'Invalid Block target';
  end if;
  if p_room_id is null and p_match_id is null then
    raise exception 'Block context is required';
  end if;

  if p_match_id is not null then
    select * into target_match
    from public.matches m
    where m.id = p_match_id;
    if target_match.id is null
       or not (target_match.user_a_id = current_user_id or target_match.user_b_id = current_user_id)
       or not (target_match.user_a_id = p_blocked_id or target_match.user_b_id = p_blocked_id) then
      raise exception 'Match context is invalid';
    end if;
    resolved_room_id := target_match.room_id;
    if p_room_id is not null and p_room_id <> resolved_room_id then
      raise exception 'Room context is invalid';
    end if;
  else
    resolved_room_id := p_room_id;
    if not exists (
      select 1
      from public.room_members mine
      join public.room_members theirs on theirs.room_id = mine.room_id
      where mine.room_id = resolved_room_id
        and mine.user_id = current_user_id
        and theirs.user_id = p_blocked_id
    ) then
      raise exception 'Room context is invalid';
    end if;
  end if;

  insert into public.blocks (
    blocker_id, blocked_id, room_id, match_id
  ) values (
    current_user_id, p_blocked_id, resolved_room_id, p_match_id
  )
  on conflict (blocker_id, blocked_id) do update
  set room_id = coalesce(public.blocks.room_id, excluded.room_id),
      match_id = coalesce(public.blocks.match_id, excluded.match_id);

  update public.interests
  set status = 'declined',
      responded_at = coalesce(responded_at, clock_timestamp())
  where status = 'pending'
    and ((from_user_id = current_user_id and to_user_id = p_blocked_id)
      or (from_user_id = p_blocked_id and to_user_id = current_user_id));

  update public.drop_items
  set action = 'passed'
  where action is null
    and ((viewer_id = current_user_id and candidate_id = p_blocked_id)
      or (viewer_id = p_blocked_id and candidate_id = current_user_id));
end;
$$;

create or replace function public.submit_report(
  p_reported_user_id uuid,
  p_room_id uuid,
  p_match_id uuid,
  p_reason text,
  p_details text default null,
  p_block boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_report_id uuid;
  target_match public.matches;
  resolved_room_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_reported_user_id is null or p_reported_user_id = current_user_id then
    raise exception 'Invalid Report target';
  end if;
  if p_reason not in ('Harassment', 'Fake profile', 'Inappropriate behavior', 'Spam', 'Safety concern', 'Other') then
    raise exception 'Invalid Report reason';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then
    raise exception 'Report details are too long';
  end if;
  if p_room_id is null and p_match_id is null then
    raise exception 'Report context is required';
  end if;

  if p_match_id is not null then
    select * into target_match
    from public.matches m
    where m.id = p_match_id;
    if target_match.id is null
       or not (target_match.user_a_id = current_user_id or target_match.user_b_id = current_user_id)
       or not (target_match.user_a_id = p_reported_user_id or target_match.user_b_id = p_reported_user_id) then
      raise exception 'Match context is invalid';
    end if;
    resolved_room_id := target_match.room_id;
    if p_room_id is not null and p_room_id <> resolved_room_id then
      raise exception 'Room context is invalid';
    end if;
  else
    resolved_room_id := p_room_id;
  end if;

  if not exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.room_id = resolved_room_id
      and mine.user_id = current_user_id
      and theirs.user_id = p_reported_user_id
  ) then
    raise exception 'Room context is invalid';
  end if;

  insert into public.reports (
    reporter_id, reported_user_id, room_id, match_id, reason, details
  ) values (
    current_user_id, p_reported_user_id, resolved_room_id, p_match_id,
    p_reason, nullif(btrim(p_details), '')
  )
  returning id into created_report_id;

  if p_block then
    insert into public.blocks (
      blocker_id, blocked_id, room_id, match_id
    ) values (
      current_user_id, p_reported_user_id, resolved_room_id, p_match_id
    )
    on conflict (blocker_id, blocked_id) do update
    set room_id = coalesce(public.blocks.room_id, excluded.room_id),
        match_id = coalesce(public.blocks.match_id, excluded.match_id);

    update public.interests
    set status = 'declined',
        responded_at = coalesce(responded_at, clock_timestamp())
    where status = 'pending'
      and ((from_user_id = current_user_id and to_user_id = p_reported_user_id)
        or (from_user_id = p_reported_user_id and to_user_id = current_user_id));

    update public.drop_items
    set action = 'passed'
    where action is null
      and ((viewer_id = current_user_id and candidate_id = p_reported_user_id)
        or (viewer_id = p_reported_user_id and candidate_id = current_user_id));
  end if;

  return created_report_id;
end;
$$;

-- One owner-only aggregate response. CTEs aggregate each canonical source once;
-- no profile, participant, Interest, Match, message, Block or Report identifiers
-- leave the function.
create or replace function public.room_analytics(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  database_now timestamptz := clock_timestamp();
  result jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'Permanent organizer account required';
  end if;
  if not exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.organizer_id = current_user_id
  ) then
    raise exception 'Organizer access required';
  end if;

  with
  member_stats as (
    select
      count(*)::integer as joined_memberships,
      count(*) filter (where rm.is_active)::integer as active_memberships
    from public.room_members rm
    where rm.room_id = p_room_id
  ),
  drop_base as (
    select
      d.id,
      d.sequence_number,
      d.scheduled_at,
      coalesce(d.opened_at, d.scheduled_at) as effective_open_at,
      d.drop_size,
      d.min_unlock_count,
      d.interest_budget
    from public.drops d
    where d.room_id = p_room_id
  ),
  drop_stats as (
    select
      count(*)::integer as scheduled_drops,
      count(*) filter (where db.effective_open_at <= database_now)::integer as effectively_opened_drops
    from drop_base db
  ),
  claim_per_drop as (
    select
      cs.drop_id,
      count(*)::integer as claim_attempts,
      count(*) filter (where cs.forming_at is not null)::integer as forming_attempts,
      count(*) filter (where cs.unlocked_at is not null)::integer as successful_unlocks
    from private.drop_claim_states cs
    where cs.room_id = p_room_id
    group by cs.drop_id
  ),
  claim_room as (
    select
      count(*)::integer as claim_attempts,
      count(*) filter (where cs.forming_at is not null)::integer as forming_attempts,
      count(*) filter (where cs.unlocked_at is not null)::integer as successful_unlocks
    from private.drop_claim_states cs
    where cs.room_id = p_room_id
  ),
  item_runs as (
    select
      di.drop_id,
      di.viewer_id,
      count(*)::integer as assigned_cards,
      count(*) filter (where di.first_seen_at is not null)::integer as cards_seen,
      bool_and(di.action is not null and di.first_seen_at is not null) as completed
    from public.drop_items di
    where di.room_id = p_room_id
    group by di.drop_id, di.viewer_id
  ),
  item_per_drop as (
    select
      ir.drop_id,
      count(*)::integer as started_runs,
      count(*) filter (where ir.completed)::integer as completed_runs,
      sum(ir.cards_seen)::integer as cards_seen,
      count(*) filter (where ir.cards_seen > 0)::integer as card_seen_participants
    from item_runs ir
    group by ir.drop_id
  ),
  item_room as (
    select
      coalesce(sum(ir.cards_seen), 0)::integer as cards_seen,
      count(*)::integer as started_runs,
      count(*) filter (where ir.completed)::integer as completed_runs,
      count(distinct ir.viewer_id)::integer as started_participants,
      count(distinct ir.viewer_id) filter (where ir.cards_seen > 0)::integer as card_seen_participants,
      count(distinct ir.viewer_id) filter (where ir.completed)::integer as completed_participants
    from item_runs ir
  ),
  interest_per_drop as (
    select
      i.drop_id,
      count(*)::integer as interests_sent,
      count(*) filter (where i.status = 'pending')::integer as pending_interests,
      count(*) filter (where i.status = 'accepted')::integer as accepted_interests,
      count(*) filter (where i.status = 'declined')::integer as declined_interests
    from public.interests i
    where i.room_id = p_room_id
    group by i.drop_id
  ),
  interest_room as (
    select
      count(*)::integer as interests_sent,
      count(*) filter (where i.status = 'pending')::integer as pending_interests,
      count(*) filter (where i.status = 'accepted')::integer as accepted_interests,
      count(*) filter (where i.status = 'declined')::integer as declined_interests,
      count(distinct i.from_user_id)::integer as interest_senders
    from public.interests i
    where i.room_id = p_room_id
  ),
  interest_open_per_drop as (
    select i.drop_id, count(*)::integer as incoming_interests_opened
    from private.interest_opens io
    join public.interests i on i.id = io.interest_id
    where io.room_id = p_room_id
    group by i.drop_id
  ),
  interest_open_room as (
    select count(*)::integer as incoming_interests_opened
    from private.interest_opens io
    where io.room_id = p_room_id
  ),
  first_messages as (
    select msg.match_id, min(msg.created_at) as first_message_at
    from public.messages msg
    join public.matches m on m.id = msg.match_id
    where m.room_id = p_room_id
    group by msg.match_id
  ),
  match_room as (
    select
      count(*)::integer as matches_created,
      count(fm.match_id)::integer as conversations_started,
      round((
        percentile_cont(0.5) within group (
          order by extract(epoch from (fm.first_message_at - m.created_at))
        ) filter (where fm.first_message_at is not null)
      )::numeric, 1) as median_match_to_first_message_seconds
    from public.matches m
    left join first_messages fm on fm.match_id = m.id
    where m.room_id = p_room_id
  ),
  match_attribution as (
    select distinct on (i.match_id)
      i.match_id,
      i.drop_id
    from public.interests i
    where i.room_id = p_room_id
      and i.status = 'accepted'
      and i.match_id is not null
    order by i.match_id, i.responded_at nulls last, i.created_at, i.id
  ),
  match_per_drop as (
    select ma.drop_id, count(*)::integer as matches_created
    from match_attribution ma
    group by ma.drop_id
  ),
  safety_stats as (
    select
      (
        select count(*)::integer
        from public.blocks b
        left join public.matches bm on bm.id = b.match_id
        where coalesce(b.room_id, bm.room_id) = p_room_id
      ) as blocks_count,
      (
        select count(*)::integer
        from public.reports rp
        left join public.matches rm on rm.id = rp.match_id
        where coalesce(rp.room_id, rm.room_id) = p_room_id
      ) as reports_count
  ),
  per_drop as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'drop_id', db.id,
          'sequence_number', db.sequence_number,
          'scheduled_at', db.scheduled_at,
          'effective_open_at', db.effective_open_at,
          'effective_status', case when db.effective_open_at <= database_now then 'opened' else 'scheduled' end,
          'claim_attempts', coalesce(cp.claim_attempts, 0),
          'forming_attempts', coalesce(cp.forming_attempts, 0),
          'successful_unlocks', coalesce(cp.successful_unlocks, 0),
          'unlock_rate', case
            when coalesce(cp.claim_attempts, 0) = 0 then null
            else round(100.0 * cp.successful_unlocks / cp.claim_attempts, 1)
          end,
          'cards_seen', coalesce(ip.cards_seen, 0),
          'started_runs', coalesce(ip.started_runs, 0),
          'completed_runs', coalesce(ip.completed_runs, 0),
          'completion_rate', case
            when coalesce(ip.started_runs, 0) = 0 then null
            else round(100.0 * ip.completed_runs / ip.started_runs, 1)
          end,
          'interests_sent', coalesce(inp.interests_sent, 0),
          'incoming_interests_opened', coalesce(iop.incoming_interests_opened, 0),
          'matches_created', coalesce(mp.matches_created, 0)
        ) order by db.sequence_number
      ), '[]'::jsonb
    ) as rows
    from drop_base db
    left join claim_per_drop cp on cp.drop_id = db.id
    left join item_per_drop ip on ip.drop_id = db.id
    left join interest_per_drop inp on inp.drop_id = db.id
    left join interest_open_per_drop iop on iop.drop_id = db.id
    left join match_per_drop mp on mp.drop_id = db.id
  )
  select jsonb_build_object(
    'room_id', p_room_id,
    'last_updated', database_now,
    'summary', jsonb_build_object(
      'joined_memberships', ms.joined_memberships,
      'active_memberships', ms.active_memberships,
      'scheduled_drops', ds.scheduled_drops,
      'effectively_opened_drops', ds.effectively_opened_drops,
      'claim_attempts', cr.claim_attempts,
      'forming_attempts', cr.forming_attempts,
      'successful_unlocks', cr.successful_unlocks,
      'cards_seen', ir.cards_seen,
      'your_drop_started_participants', ir.started_participants,
      'card_seen_participants', ir.card_seen_participants,
      'your_drop_started_runs', ir.started_runs,
      'your_drop_completed_runs', ir.completed_runs,
      'your_drop_completed_participants', ir.completed_participants,
      'interests_sent', ints.interests_sent,
      'interest_senders', ints.interest_senders,
      'incoming_interests_opened', ior.incoming_interests_opened,
      'pending_interests', ints.pending_interests,
      'accepted_interests', ints.accepted_interests,
      'declined_interests', ints.declined_interests,
      'matches_created', mr.matches_created,
      'conversations_started', mr.conversations_started,
      'median_match_to_first_message_seconds', mr.median_match_to_first_message_seconds,
      'blocks_count', ss.blocks_count,
      'reports_count', ss.reports_count
    ),
    'rates', jsonb_build_object(
      'unlock_rate', case
        when cr.claim_attempts = 0 then null
        else round(100.0 * cr.successful_unlocks / cr.claim_attempts, 1)
      end,
      'drop_completion_rate', case
        when ir.started_runs = 0 then null
        else round(100.0 * ir.completed_runs / ir.started_runs, 1)
      end,
      'interest_response_rate', case
        when ints.interests_sent = 0 then null
        else round(100.0 * (ints.accepted_interests + ints.declined_interests) / ints.interests_sent, 1)
      end,
      'interest_acceptance_rate', case
        when (ints.accepted_interests + ints.declined_interests) = 0 then null
        else round(100.0 * ints.accepted_interests / (ints.accepted_interests + ints.declined_interests), 1)
      end,
      'interest_decline_rate', case
        when (ints.accepted_interests + ints.declined_interests) = 0 then null
        else round(100.0 * ints.declined_interests / (ints.accepted_interests + ints.declined_interests), 1)
      end,
      'match_to_conversation_rate', case
        when mr.matches_created = 0 then null
        else round(100.0 * mr.conversations_started / mr.matches_created, 1)
      end
    ),
    'drops', pd.rows,
    'collection_scope', jsonb_build_object(
      'historical', jsonb_build_array(
        'joined_memberships', 'active_memberships', 'scheduled_drops',
        'effectively_opened_drops', 'cards_seen', 'your_drop_runs',
        'interests', 'matches', 'conversations', 'reports'
      ),
      'sprint4_onward', jsonb_build_array(
        'claim_attempts', 'forming_attempts', 'successful_unlocks',
        'incoming_interests_opened', 'attributed_blocks'
      )
    )
  ) into result
  from member_stats ms
  cross join drop_stats ds
  cross join claim_room cr
  cross join item_room ir
  cross join interest_room ints
  cross join interest_open_room ior
  cross join match_room mr
  cross join safety_stats ss
  cross join per_drop pd;

  return result;
end;
$$;

-- Direct writes would allow forged attribution. Product roles use only the
-- narrow, identity-bound functions above.
revoke all on public.blocks from anon, authenticated;
grant select, delete on public.blocks to authenticated;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

revoke all on function public.claim_your_drop(uuid) from public, anon;
grant execute on function public.claim_your_drop(uuid) to authenticated;

revoke all on function public.mark_incoming_interest_opened(uuid) from public, anon, authenticated;
grant execute on function public.mark_incoming_interest_opened(uuid) to authenticated;

revoke all on function public.block_user(uuid) from public, anon, authenticated;
revoke all on function public.block_user_in_context(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.block_user_in_context(uuid, uuid, uuid) to authenticated;

revoke all on function public.submit_report(uuid, uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.submit_report(uuid, uuid, uuid, text, text, boolean) to authenticated;

revoke all on function public.room_analytics(uuid) from public, anon, authenticated;
grant execute on function public.room_analytics(uuid) to authenticated;
