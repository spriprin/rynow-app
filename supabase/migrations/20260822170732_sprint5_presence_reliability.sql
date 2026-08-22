-- Sprint 5: recent presence, concurrent retry safety and pilot diagnostics.
-- Membership remains persistent. Only discovery eligibility expires after five
-- minutes without a server-timestamped heartbeat.

create index room_members_room_recent_idx
  on public.room_members (room_id, last_seen_at desc)
  where is_active = true;

alter table public.messages
  add column client_message_id uuid;

alter table public.reports
  add column client_action_id uuid;

create unique index messages_sender_client_message_uidx
  on public.messages (sender_id, client_message_id)
  where client_message_id is not null;

create unique index reports_reporter_client_action_uidx
  on public.reports (reporter_id, client_action_id)
  where client_action_id is not null;

-- Existing membership helpers now mean recent presence inside an open Room.
-- Match/chat access does not use these helpers, so an ended Room or stale
-- heartbeat never destroys an existing connection.
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
    join public.rooms r on r.id = rm.room_id
    where rm.room_id = target_room
      and rm.user_id = target_user
      and rm.is_active = true
      and rm.last_seen_at >= now() - interval '5 minutes'
      and r.status = 'open'
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
    join public.rooms r on r.id = mine.room_id
    where mine.user_id = viewer
      and theirs.user_id = target
      and mine.is_active = true
      and theirs.is_active = true
      and mine.last_seen_at >= now() - interval '5 minutes'
      and theirs.last_seen_at >= now() - interval '5 minutes'
      and r.status = 'open'
  );
$$;

create or replace function public.is_current_user_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_room_member(target_room, (select auth.uid()));
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

revoke all on function public.is_room_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.shares_active_room(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_current_user_room_member(uuid) from public, anon, authenticated;
revoke all on function public.shares_current_user_active_room(uuid) from public, anon, authenticated;
grant execute on function public.is_current_user_room_member(uuid) to authenticated;
grant execute on function public.shares_current_user_active_room(uuid) to authenticated;

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
  if not exists (
    select 1 from public.rooms r where r.id = p_room_id and r.status = 'open'
  ) then
    raise exception 'This Room has ended.';
  end if;

  update public.room_members rm
  set last_seen_at = heartbeat_at,
      is_active = true
  where rm.room_id = p_room_id
    and rm.user_id = current_user_id;

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
  left_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  update public.room_members rm
  set last_seen_at = left_at,
      is_active = false
  where rm.room_id = p_room_id
    and rm.user_id = current_user_id;
  if not found then raise exception 'Room membership required'; end if;
  return left_at;
end;
$$;

-- Presence timestamps and active state are server-owned after Sprint 5. The
-- legacy self-update policy remains defense in depth, but product roles no
-- longer have table UPDATE privilege.
revoke update on public.room_members from authenticated;

create or replace function public.organizer_room_presence_counts()
returns table (
  room_id uuid,
  joined_count bigint,
  recent_count bigint,
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
  select
    r.id,
    count(rm.user_id)::bigint,
    count(rm.user_id) filter (
      where rm.is_active = true
        and rm.last_seen_at >= database_now - interval '5 minutes'
    )::bigint,
    database_now
  from public.rooms r
  left join public.room_members rm on rm.room_id = r.id
  where r.organizer_id = current_user_id
  group by r.id;
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
set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_path, rm.joined_at
  from public.room_members rm
  join public.profiles p on p.id = rm.user_id
  where rm.room_id = p_room_id
    and rm.is_active = true
    and rm.last_seen_at >= now() - interval '5 minutes'
    and public.is_room_member(p_room_id, (select auth.uid()))
  order by rm.last_seen_at desc, rm.joined_at desc
  limit least(greatest(coalesce(p_limit, 12), 1), 12);
$$;

-- Signed Room avatars require recent mutual presence. Existing unblocked Match
-- partners retain avatar access after presence expires or the Room closes.
alter policy avatars_read_owner_or_shared_room on storage.objects
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.shares_current_user_active_room(
      public.safe_uuid((storage.foldername(name))[1])
    )
    or exists (
      select 1
      from public.matches m
      where (
        (m.user_a_id = (select auth.uid()) and m.user_b_id = public.safe_uuid((storage.foldername(name))[1]))
        or
        (m.user_b_id = (select auth.uid()) and m.user_a_id = public.safe_uuid((storage.foldername(name))[1]))
      )
        and not public.is_pair_blocked(m.user_a_id, m.user_b_id)
    )
  )
);

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
  database_now timestamptz := clock_timestamp();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_room_member(p_room_id, current_user_id) then
    raise exception 'Room access required';
  end if;

  select d.* into current_drop
  from public.drops d
  where d.room_id = p_room_id
    and coalesce(d.opened_at, d.scheduled_at) <= database_now
    and exists (
      select 1 from public.drop_items di
      where di.drop_id = d.id
        and di.viewer_id = current_user_id
        and di.action is null
        and not public.is_pair_blocked(current_user_id, di.candidate_id)
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
    where di.drop_id = current_drop.id
      and di.viewer_id = current_user_id
      and not public.is_pair_blocked(current_user_id, di.candidate_id);

    select count(*)::integer into used_total
    from public.interests i
    where i.drop_id = current_drop.id and i.from_user_id = current_user_id;

    select count(*)::integer into active_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = p_room_id
      and rm.is_active = true
      and rm.last_seen_at >= database_now - interval '5 minutes'
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and not public.is_pair_blocked(current_user_id, rm.user_id);

    select count(*)::integer into eligible_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = p_room_id
      and rm.is_active = true
      and rm.last_seen_at >= database_now - interval '5 minutes'
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and not public.is_pair_blocked(current_user_id, rm.user_id)
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
      and rm.last_seen_at >= instrumentation_now - interval '5 minutes'
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
        and rm.last_seen_at >= instrumentation_now - interval '5 minutes'
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

-- Keep the complete Sprint 4 aggregate implementation intact and layer only
-- the new current-presence definition over its response.
alter function public.room_analytics(uuid)
  rename to room_analytics_sprint4_internal;

revoke all on function public.room_analytics_sprint4_internal(uuid)
  from public, anon, authenticated;

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
  recent_total integer;
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

  result := public.room_analytics_sprint4_internal(p_room_id);
  select count(*)::integer into recent_total
  from public.room_members rm
  where rm.room_id = p_room_id
    and rm.is_active = true
    and rm.last_seen_at >= now() - interval '5 minutes';

  result := jsonb_set(result, '{summary,active_memberships}', to_jsonb(recent_total), false);
  result := result || jsonb_build_object(
    'presence_model', jsonb_build_object(
      'heartbeat_seconds', 60,
      'active_timeout_seconds', 300,
      'definition', 'recent server heartbeat'
    )
  );
  return result;
end;
$$;

create or replace function public.send_match_message_idempotent(
  p_match_id uuid,
  p_body text,
  p_client_message_id uuid
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
  created_message public.messages;
  clean_body text := btrim(p_body);
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_client_message_id is null then raise exception 'Message request ID required'; end if;
  if clean_body is null or char_length(clean_body) not between 1 and 1000 then
    raise exception 'Message must be between 1 and 1000 characters';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(current_user_id::text),
    hashtext(p_client_message_id::text)
  );

  select * into created_message
  from public.messages msg
  where msg.sender_id = current_user_id
    and msg.client_message_id = p_client_message_id;

  if created_message.id is not null then
    if created_message.match_id <> p_match_id or created_message.body <> clean_body then
      raise exception 'Message request ID already used';
    end if;
    return created_message;
  end if;

  select * into target_match
  from public.matches m
  where m.id = p_match_id
  for update;
  if target_match.id is null
     or (target_match.user_a_id <> current_user_id and target_match.user_b_id <> current_user_id) then
    raise exception 'Match access required';
  end if;
  if public.is_pair_blocked(target_match.user_a_id, target_match.user_b_id) then
    raise exception 'Messaging is unavailable';
  end if;

  insert into public.messages (match_id, sender_id, body, client_message_id)
  values (target_match.id, current_user_id, clean_body, p_client_message_id)
  returning * into created_message;

  update public.matches
  set last_message_at = greatest(coalesce(last_message_at, created_message.created_at), created_message.created_at)
  where id = target_match.id;
  return created_message;
end;
$$;

create or replace function public.submit_report_idempotent(
  p_reported_user_id uuid,
  p_room_id uuid,
  p_match_id uuid,
  p_reason text,
  p_details text default null,
  p_block boolean default false,
  p_client_action_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_report public.reports;
  target_match public.matches;
  resolved_room_id uuid;
  clean_details text := nullif(btrim(p_details), '');
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_client_action_id is null then raise exception 'Report request ID required'; end if;
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

  perform pg_advisory_xact_lock(
    hashtext(current_user_id::text),
    hashtext(p_client_action_id::text)
  );

  select * into created_report
  from public.reports rp
  where rp.reporter_id = current_user_id
    and rp.client_action_id = p_client_action_id;

  if created_report.id is not null then
    if created_report.reported_user_id <> p_reported_user_id
       or created_report.room_id is distinct from p_room_id
       or created_report.match_id is distinct from p_match_id
       or created_report.reason <> p_reason
       or created_report.details is distinct from clean_details then
      raise exception 'Report request ID already used';
    end if;
    return created_report.id;
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
    reporter_id, reported_user_id, room_id, match_id, reason, details,
    client_action_id
  ) values (
    current_user_id, p_reported_user_id, resolved_room_id, p_match_id,
    p_reason, clean_details, p_client_action_id
  )
  returning * into created_report;

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

  return created_report.id;
end;
$$;

revoke all on function public.heartbeat_room_presence(uuid) from public, anon, authenticated;
grant execute on function public.heartbeat_room_presence(uuid) to authenticated;

revoke all on function public.leave_room_presence(uuid) from public, anon, authenticated;
grant execute on function public.leave_room_presence(uuid) to authenticated;

revoke all on function public.organizer_room_presence_counts() from public, anon, authenticated;
grant execute on function public.organizer_room_presence_counts() to authenticated;

revoke all on function public.room_drop_state(uuid) from public, anon, authenticated;
grant execute on function public.room_drop_state(uuid) to authenticated;

revoke all on function public.claim_your_drop(uuid) from public, anon, authenticated;
grant execute on function public.claim_your_drop(uuid) to authenticated;

revoke all on function public.room_analytics(uuid) from public, anon, authenticated;
grant execute on function public.room_analytics(uuid) to authenticated;

revoke all on function public.send_match_message_idempotent(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.send_match_message_idempotent(uuid, text, uuid)
  to authenticated;

revoke all on function public.submit_report_idempotent(uuid, uuid, uuid, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_report_idempotent(uuid, uuid, uuid, text, text, boolean, uuid)
  to authenticated;
