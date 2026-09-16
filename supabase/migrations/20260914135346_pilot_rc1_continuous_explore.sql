-- PILOT RC1 / Phase 2A. PREPARED ONLY: apply to isolated staging before production.
-- Historical Drop tables, rows and RPC definitions remain intact. Their client
-- privileges are revoked below; no active RC1 RPC calls them.
begin;

-- Snapshot previously viewed Drop cards once. RC1 runtime reads this private
-- ledger, never the historical Drop tables, so a guest is not shown someone
-- already viewed in the same Room before the product transition.
create table private.rc1_legacy_seen_profiles (
  room_id uuid not null references public.rooms(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null,
  primary key(room_id,viewer_id,candidate_id)
);
create index rc1_legacy_seen_candidate_idx
  on private.rc1_legacy_seen_profiles(room_id,candidate_id);
alter table private.rc1_legacy_seen_profiles enable row level security;
revoke all on private.rc1_legacy_seen_profiles from public,anon,authenticated;
insert into private.rc1_legacy_seen_profiles(room_id,viewer_id,candidate_id,first_seen_at)
select room_id,viewer_id,candidate_id,min(first_seen_at)
from public.drop_items where first_seen_at is not null
group by room_id,viewer_id,candidate_id;

create or replace function private.viewer_has_seen_candidate(p_room_id uuid, p_viewer_id uuid, p_candidate_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.explore_items
    where room_id=p_room_id and viewer_id=p_viewer_id and candidate_id=p_candidate_id and first_seen_at is not null)
    or exists (select 1 from private.rc1_legacy_seen_profiles
      where room_id=p_room_id and viewer_id=p_viewer_id and candidate_id=p_candidate_id);
$$;
create or replace function private.viewer_has_pending_candidate(p_room_id uuid, p_viewer_id uuid, p_candidate_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.explore_items
    where room_id=p_room_id and viewer_id=p_viewer_id and candidate_id=p_candidate_id and action is null and invalidated_at is null);
$$;
create or replace function private.discovery_delivered_count(p_room_id uuid, p_candidate_id uuid)
returns integer language sql stable set search_path = '' as $$
  select (
    (select count(*) from public.explore_items
      where room_id=p_room_id and candidate_id=p_candidate_id and first_seen_at is not null)
    + (select count(*) from private.rc1_legacy_seen_profiles
      where room_id=p_room_id and candidate_id=p_candidate_id)
  )::integer;
$$;
create or replace function private.discovery_pending_count(p_room_id uuid, p_candidate_id uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.explore_items
    where room_id=p_room_id and candidate_id=p_candidate_id and first_seen_at is null and invalidated_at is null and action is null;
$$;

create or replace function private.rc1_candidate_available(p_room_id uuid, p_viewer_id uuid, p_candidate_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_viewer_id <> p_candidate_id
    and private.is_discovery_eligible(p_room_id,p_candidate_id,now())
    and private.viewer_accepts_candidate(p_viewer_id,p_candidate_id)
    and not public.is_pair_blocked(p_viewer_id,p_candidate_id)
    and not exists (select 1 from public.matches m where m.status='active'
      and m.user_a_id=least(p_viewer_id,p_candidate_id) and m.user_b_id=greatest(p_viewer_id,p_candidate_id))
    and not exists (select 1 from public.interests i where i.room_id=p_room_id
      and ((i.from_user_id=p_viewer_id and i.to_user_id=p_candidate_id)
        or (i.from_user_id=p_candidate_id and i.to_user_id=p_viewer_id)));
$$;

create or replace function private.invalidate_stale_discovery_assignments(p_room_id uuid,p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.explore_items ei set invalidated_at=p_now
  where ei.room_id=p_room_id and ei.action is null and ei.invalidated_at is null
    and (not private.is_discovery_eligible(p_room_id,ei.candidate_id,p_now)
      or public.is_pair_blocked(ei.viewer_id,ei.candidate_id)
      or exists (select 1 from public.matches m where m.status='active'
        and m.user_a_id=least(ei.viewer_id,ei.candidate_id) and m.user_b_id=greatest(ei.viewer_id,ei.candidate_id)));
end;
$$;

-- Internal batches are transport/storage containers, never an Interest budget
-- or timer. Pending cards may span batches, but only ten reach the client.
create or replace function private.complete_explore_batch_if_finished(p_batch_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.explore_batches b set completed_at=statement_timestamp(),cooldown_until=statement_timestamp()
  where b.id=p_batch_id and b.completed_at is null
    and not exists(select 1 from public.explore_items i where i.batch_id=b.id and i.action is null and i.invalidated_at is null);
end;
$$;

create or replace function public.explore_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.room_members; payload jsonb;
begin
  select * into member from public.room_members where room_id=p_room_id and user_id=auth.uid();
  if member.user_id is null then raise exception 'Room membership required'; end if;
  if not member.discovery_enabled or member.left_at is not null then
    return jsonb_build_object('status','left','batch_id',null,'items','[]'::jsonb,
      'assigned_count',0,'remaining_count',0,'discovery_enabled',false,
      'left_at',member.left_at,'server_now',clock_timestamp());
  end if;
  if not private.is_discovery_eligible(p_room_id,auth.uid(),now()) then raise exception 'Room discovery unavailable'; end if;
  select coalesce(jsonb_agg(to_jsonb(cards) order by cards.created_at,cards.position),'[]'::jsonb) into payload
  from (
    select i.id,i.batch_id,i.position,i.first_seen_at,i.action,i.candidate_id,p.display_name,p.avatar_path,i.created_at
    from public.explore_items i join public.profiles p on p.id=i.candidate_id
    where i.room_id=p_room_id and i.viewer_id=auth.uid() and i.action is null and i.invalidated_at is null
      and not exists(select 1 from private.rc1_legacy_seen_profiles h
        where h.room_id=p_room_id and h.viewer_id=auth.uid() and h.candidate_id=i.candidate_id)
      and private.rc1_candidate_available(p_room_id,auth.uid(),i.candidate_id)
    order by i.created_at,i.position limit 10
  ) cards;
  return jsonb_build_object(
    'status',case when jsonb_array_length(payload)>0 then 'active' else 'caught_up' end,
    'batch_id',(select (card.value->>'batch_id')::uuid from jsonb_array_elements(payload) as card(value) limit 1),
    'items',payload,'assigned_count',jsonb_array_length(payload),
    'remaining_count',jsonb_array_length(payload),'discovery_enabled',true,
    'left_at',null,'server_now',clock_timestamp());
end;
$$;

create or replace function public.claim_explore_batch(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); pending integer; batch uuid; seq integer; has_candidate boolean;
begin
  if u is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_room_id::text),hashtext('rc1-explore'));
  if not private.is_discovery_eligible(p_room_id,u,now()) or not private.has_complete_discovery_profile(u)
    then raise exception 'Rejoin the event to continue discovery'; end if;
  perform private.invalidate_stale_discovery_assignments(p_room_id,clock_timestamp());
  -- Invalidate unseen cards whose preference/pending-Interest relationship changed.
  update public.explore_items i set invalidated_at=clock_timestamp()
    where i.room_id=p_room_id and i.viewer_id=u and i.action is null and i.invalidated_at is null
      and (not private.rc1_candidate_available(p_room_id,u,i.candidate_id)
        or exists(select 1 from private.rc1_legacy_seen_profiles h
          where h.room_id=p_room_id and h.viewer_id=u and h.candidate_id=i.candidate_id));
  select count(*) into pending from public.explore_items
    where room_id=p_room_id and viewer_id=u and action is null and invalidated_at is null;
  select exists(
    select 1 from public.room_members rm
    where rm.room_id=p_room_id
      and private.rc1_candidate_available(p_room_id,u,rm.user_id)
      and not private.viewer_has_seen_candidate(p_room_id,u,rm.user_id)
      and not private.viewer_has_pending_candidate(p_room_id,u,rm.user_id)
  ) into has_candidate;
  if pending<=3 and has_candidate then
    update public.explore_batches set completed_at=statement_timestamp(),cooldown_until=statement_timestamp()
      where room_id=p_room_id and viewer_id=u and completed_at is null;
    select coalesce(max(sequence_number),0)+1 into seq from public.explore_batches where room_id=p_room_id and viewer_id=u;
    insert into public.explore_batches(room_id,viewer_id,sequence_number,target_size)
      values(p_room_id,u,seq,10-pending) returning id into batch;
    insert into public.explore_items(batch_id,room_id,viewer_id,candidate_id,position)
    select batch,p_room_id,u,candidate_id,row_number() over ()::integer from (
      select rm.user_id candidate_id
      from public.room_members rm
      where rm.room_id=p_room_id
        and private.rc1_candidate_available(p_room_id,u,rm.user_id)
        and not private.viewer_has_seen_candidate(p_room_id,u,rm.user_id)
        and not private.viewer_has_pending_candidate(p_room_id,u,rm.user_id)
      -- Fair Exposure: impressions + reserved unseen cards, not likes/popularity.
      order by floor((private.discovery_delivered_count(p_room_id,rm.user_id)
        + private.discovery_pending_count(p_room_id,rm.user_id))::numeric/2),random()
      limit greatest(0,10-pending)
    ) ranked;
    perform private.complete_explore_batch_if_finished(batch);
  end if;
  return public.explore_state(p_room_id);
end;
$$;

create index interests_sender_created_rc1_idx on public.interests(from_user_id,created_at desc);
create table private.pilot_settings (
  singleton boolean primary key default true check(singleton),
  rapid_interest_limit integer not null default 20 check(rapid_interest_limit between 5 and 100),
  rapid_interest_window_seconds integer not null default 60 check(rapid_interest_window_seconds between 10 and 3600),
  operational_retention_days integer not null default 30 check(operational_retention_days>0),
  connection_retention_days integer not null default 90 check(connection_retention_days>0),
  safety_retention_days integer not null default 180 check(safety_retention_days>0),
  cleanup_enabled boolean not null default false check(cleanup_enabled=false)
);
insert into private.pilot_settings(singleton) values(true);
revoke all on private.pilot_settings from public,anon,authenticated;

create or replace function public.send_explore_interest(p_explore_item_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); item public.explore_items; rate private.pilot_settings; n integer;
begin
  if u is null then raise exception 'Authentication required'; end if;
  select * into item from public.explore_items where id=p_explore_item_id and viewer_id=u;
  if item.id is null then raise exception 'Explore item not found'; end if;
  perform pg_advisory_xact_lock(hashtext(item.room_id::text),hashtext('rc1-explore'));
  perform pg_advisory_xact_lock(hashtext(u::text),hashtext('rc1-interest-rate'));
  select * into item from public.explore_items where id=p_explore_item_id and viewer_id=u for update;
  if item.action='interested' then return 1; end if; -- network retry, not a second Interest
  if item.invalidated_at is not null or item.action is not null or item.first_seen_at is null then raise exception 'Show an available card first'; end if;
  if not private.is_discovery_eligible(item.room_id,u,now())
    or not private.rc1_candidate_available(item.room_id,u,item.candidate_id)
    then raise exception 'This interaction is unavailable'; end if;
  select * into rate from private.pilot_settings where singleton;
  select count(*) into n from public.interests where from_user_id=u
    and created_at>clock_timestamp()-make_interval(secs=>rate.rapid_interest_window_seconds);
  if n>=rate.rapid_interest_limit then raise exception 'Please slow down and try again shortly'; end if;
  insert into public.interests(room_id,explore_batch_id,explore_item_id,from_user_id,to_user_id)
    values(item.room_id,item.batch_id,item.id,u,item.candidate_id);
  update public.explore_items set action='interested' where id=item.id;
  perform private.complete_explore_batch_if_finished(item.batch_id);
  return 1; -- acknowledgement only; never Interests remaining
end;
$$;

create or replace function public.mark_explore_item_seen(p_explore_item_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare item public.explore_items; seen timestamptz;
begin
  select * into item from public.explore_items where id=p_explore_item_id and viewer_id=auth.uid();
  if item.id is null then raise exception 'Explore item not found'; end if;
  perform pg_advisory_xact_lock(hashtext(item.room_id::text),hashtext('rc1-explore'));
  if item.invalidated_at is not null or item.action is not null
    or not private.is_discovery_eligible(item.room_id,auth.uid(),now())
    or not private.rc1_candidate_available(item.room_id,auth.uid(),item.candidate_id)
    then raise exception 'This person is no longer available'; end if;
  update public.explore_items set first_seen_at=coalesce(first_seen_at,clock_timestamp())
    where id=item.id and invalidated_at is null and action is null returning first_seen_at into seen;
  if seen is null then raise exception 'This person is no longer available'; end if;
  return seen;
end;
$$;

create or replace function public.leave_room_presence(p_room_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare departed timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext(p_room_id::text),hashtext('rc1-explore'));
  update public.room_members set is_active=false,discovery_enabled=false,left_at=coalesce(left_at,departed)
    where room_id=p_room_id and user_id=auth.uid();
  if not found then raise exception 'Room membership required'; end if;
  update public.explore_items set invalidated_at=departed
    where room_id=p_room_id and candidate_id=auth.uid() and action is null and invalidated_at is null;
  return departed;
end;
$$;

create or replace function public.can_current_user_read_current_avatar(target uuid,object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=target and p.avatar_path=object_name)
    and (target=auth.uid() or (not public.is_pair_blocked(auth.uid(),target) and (
      exists(select 1 from public.room_members a join public.room_members b using(room_id)
        where a.user_id=auth.uid() and b.user_id=target
          and private.is_discovery_eligible(a.room_id,auth.uid(),now()) and private.is_discovery_eligible(a.room_id,target,now()))
      or exists(select 1 from public.interests i where i.status='pending'
        and i.to_user_id=auth.uid() and i.from_user_id=target)
      or exists(select 1 from public.matches m where m.status='active'
        and m.user_a_id=least(auth.uid(),target) and m.user_b_id=greatest(auth.uid(),target))
    )));
$$;

-- Deprecation is privilege-only, not data/definition destruction.
revoke all on function public.room_drop_state(uuid) from public,anon,authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (
      p.proname like '%drop%' or p.proname='send_interest'
    )
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('comment on function %s is %L',f.signature,'Deprecated for Pilot RC1. Historical data only. No client execution.');
  end loop;
end;
$$;
revoke all on function private.rc1_candidate_available(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.explore_state(uuid),public.claim_explore_batch(uuid),
  public.send_explore_interest(uuid),public.mark_explore_item_seen(uuid),public.leave_room_presence(uuid)
  from public,anon,authenticated;
grant execute on function public.explore_state(uuid),public.claim_explore_batch(uuid),
  public.send_explore_interest(uuid),public.mark_explore_item_seen(uuid),public.leave_room_presence(uuid) to authenticated;
commit;
