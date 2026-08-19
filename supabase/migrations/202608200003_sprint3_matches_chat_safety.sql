-- HERE Sprint 3: reciprocal Interest, idempotent Match, text chat, Block and Report.
-- Additive migration only. Sprint 1 and Sprint 2 migrations remain unchanged.

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'active',
  last_message_at timestamptz,
  constraint match_pair_canonical check (user_a_id::text < user_b_id::text),
  constraint valid_match_status check (status in ('active')),
  constraint matches_room_pair_unique unique (room_id, user_a_id, user_b_id)
);

alter table public.interests
  add column if not exists status text not null default 'pending',
  add column if not exists responded_at timestamptz,
  add column if not exists match_id uuid references public.matches(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'valid_interest_status'
      and conrelid = 'public.interests'::regclass
  ) then
    alter table public.interests
      add constraint valid_interest_status
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end;
$$;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint valid_message_body check (
    char_length(btrim(body)) between 1 and 1000
  )
);

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint block_not_self check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  reason text not null,
  details text,
  created_at timestamptz not null default now(),
  status text not null default 'submitted',
  constraint report_not_self check (reporter_id <> reported_user_id),
  constraint report_has_context check (room_id is not null or match_id is not null),
  constraint valid_report_reason check (
    reason in ('Harassment', 'Fake profile', 'Inappropriate behavior', 'Spam', 'Safety concern', 'Other')
  ),
  constraint valid_report_details check (details is null or char_length(details) <= 1000),
  constraint valid_report_status check (status in ('submitted', 'reviewing', 'resolved', 'dismissed'))
);

create index if not exists matches_user_a_recent_idx
  on public.matches (user_a_id, last_message_at desc nulls last, created_at desc);
create index if not exists matches_user_b_recent_idx
  on public.matches (user_b_id, last_message_at desc nulls last, created_at desc);
create index if not exists messages_match_created_idx
  on public.messages (match_id, created_at, id);
create index if not exists messages_unread_idx
  on public.messages (match_id, sender_id, created_at) where read_at is null;
create index if not exists blocks_blocked_lookup_idx
  on public.blocks (blocked_id, blocker_id);
create index if not exists reports_reporter_recent_idx
  on public.reports (reporter_id, created_at desc);
create index if not exists reports_moderation_idx
  on public.reports (status, created_at);

create or replace function public.is_pair_blocked(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select first_user is not null
    and second_user is not null
    and auth.uid() is not null
    and (auth.uid() = first_user or auth.uid() = second_user)
    and exists (
    select 1 from public.blocks b
    where (b.blocker_id = first_user and b.blocked_id = second_user)
       or (b.blocker_id = second_user and b.blocked_id = first_user)
  );
$$;

create or replace function public.can_access_match(target_match uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user = auth.uid() and exists (
    select 1 from public.matches m
    where m.id = target_match
      and (m.user_a_id = target_user or m.user_b_id = target_user)
      and not public.is_pair_blocked(m.user_a_id, m.user_b_id)
  );
$$;

-- Sprint 2 state remains popularity-neutral; Block filtering happens before
-- exposure balancing and before the UI receives any candidate information.
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
      and rm.user_id <> current_user_id
      and p.age_confirmed_18 = true
      and p.avatar_path is not null
      and not public.is_pair_blocked(current_user_id, rm.user_id);

    select count(*)::integer into eligible_total
    from public.room_members rm
    join public.profiles p on p.id = rm.user_id
    where rm.room_id = p_room_id
      and rm.is_active = true
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
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_drop public.drops;
  eligible_total integer;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_drop from public.drops d where d.id = p_drop_id for update;
  if target_drop.id is null then raise exception 'Drop not found'; end if;
  if coalesce(target_drop.opened_at, target_drop.scheduled_at) > clock_timestamp() then
    raise exception 'This Drop is not open yet';
  end if;
  if not exists (select 1 from public.rooms r where r.id = target_drop.room_id and r.status = 'open') then
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
      and not public.is_pair_blocked(current_user_id, rm.user_id)
      and not exists (
        select 1 from public.drop_items seen
        where seen.room_id = target_drop.room_id
          and seen.viewer_id = current_user_id
          and seen.candidate_id = rm.user_id
          and seen.first_seen_at is not null
      );

    if eligible_total < target_drop.min_unlock_count then return; end if;

    insert into public.drop_items (drop_id, room_id, viewer_id, candidate_id, position)
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

  perform pg_advisory_xact_lock(hashtext(current_user_id::text), hashtext(target_item.drop_id::text));
  if target_item.first_seen_at is null then raise exception 'Show the card before sending Interest'; end if;
  if target_item.action is not null then raise exception 'This card was already handled'; end if;
  if not exists (select 1 from public.rooms r where r.id = target_item.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  if not public.is_room_member(target_item.room_id, current_user_id)
     or not public.is_room_member(target_item.room_id, target_item.candidate_id) then
    raise exception 'Both people must be active in this Room';
  end if;
  if public.is_pair_blocked(current_user_id, target_item.candidate_id) then
    raise exception 'This interaction is unavailable';
  end if;
  if exists (
    select 1 from public.interests i
    where i.room_id = target_item.room_id
      and i.from_user_id = current_user_id
      and i.to_user_id = target_item.candidate_id
  ) then
    raise exception 'Interest already sent to this person';
  end if;

  select d.interest_budget into allowed_budget from public.drops d where d.id = target_item.drop_id;
  select count(*)::integer into used_budget
  from public.interests i
  where i.drop_id = target_item.drop_id and i.from_user_id = current_user_id;
  if used_budget >= allowed_budget then raise exception 'No Interests left in this Drop'; end if;

  insert into public.interests (room_id, drop_id, drop_item_id, from_user_id, to_user_id)
  values (target_item.room_id, target_item.drop_id, target_item.id, current_user_id, target_item.candidate_id);
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
  if not public.is_room_member(p_room_id, auth.uid()) then raise exception 'Room access required'; end if;
  return query
  select i.id, i.from_user_id, p.display_name, p.avatar_path, i.created_at
  from public.interests i
  join public.profiles p on p.id = i.from_user_id
  where i.room_id = p_room_id
    and i.to_user_id = auth.uid()
    and i.status = 'pending'
    and not public.is_pair_blocked(i.from_user_id, i.to_user_id)
  order by i.created_at desc
  limit 50;
end;
$$;

create or replace function public.respond_to_interest(p_interest_id uuid, p_interested boolean)
returns uuid
language plpgsql
security definer
set search_path = public
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
  select * into target_interest
  from public.interests i
  where i.id = p_interest_id and i.to_user_id = current_user_id
  for update;
  if target_interest.id is null then raise exception 'Incoming Interest not found'; end if;

  if target_interest.status <> 'pending' then
    if target_interest.status = 'accepted' and p_interested then
      return target_interest.match_id;
    end if;
    if target_interest.status = 'declined' and not p_interested then return null; end if;
    raise exception 'This Interest was already processed';
  end if;

  if not exists (select 1 from public.rooms r where r.id = target_interest.room_id and r.status = 'open') then
    raise exception 'This Room has ended.';
  end if;
  if not public.is_room_member(target_interest.room_id, current_user_id)
     or not public.is_room_member(target_interest.room_id, target_interest.from_user_id) then
    raise exception 'Both people must be active in this Room';
  end if;
  if public.is_pair_blocked(current_user_id, target_interest.from_user_id) then
    raise exception 'This interaction is unavailable';
  end if;

  if not p_interested then
    update public.interests
    set status = 'declined', responded_at = clock_timestamp()
    where id = target_interest.id;
    return null;
  end if;

  if target_interest.from_user_id::text < current_user_id::text then
    first_user := target_interest.from_user_id;
    second_user := current_user_id;
  else
    first_user := current_user_id;
    second_user := target_interest.from_user_id;
  end if;

  insert into public.matches (room_id, user_a_id, user_b_id)
  values (target_interest.room_id, first_user, second_user)
  on conflict (room_id, user_a_id, user_b_id) do nothing;

  select m.id into resolved_match_id
  from public.matches m
  where m.room_id = target_interest.room_id
    and m.user_a_id = first_user
    and m.user_b_id = second_user;

  update public.interests
  set status = 'accepted', responded_at = clock_timestamp(), match_id = resolved_match_id
  where room_id = target_interest.room_id
    and status = 'pending'
    and (
      (from_user_id = first_user and to_user_id = second_user)
      or (from_user_id = second_user and to_user_id = first_user)
    );

  return resolved_match_id;
end;
$$;

create or replace function public.room_matches(p_room_id uuid)
returns table (
  match_id uuid,
  other_user_id uuid,
  display_name text,
  avatar_path text,
  matched_at timestamptz,
  last_message_at timestamptz,
  last_message_body text,
  unread_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    case when m.user_a_id = auth.uid() then m.user_b_id else m.user_a_id end,
    p.display_name,
    p.avatar_path,
    m.created_at,
    m.last_message_at,
    latest.body,
    (
      select count(*)::integer from public.messages unread
      where unread.match_id = m.id
        and unread.sender_id <> auth.uid()
        and unread.read_at is null
    )
  from public.matches m
  join public.profiles p on p.id = case when m.user_a_id = auth.uid() then m.user_b_id else m.user_a_id end
  left join lateral (
    select msg.body
    from public.messages msg
    where msg.match_id = m.id
    order by msg.created_at desc, msg.id desc
    limit 1
  ) latest on true
  where m.room_id = p_room_id
    and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    and not public.is_pair_blocked(m.user_a_id, m.user_b_id)
  order by coalesce(m.last_message_at, m.created_at) desc;
$$;

create or replace function public.send_match_message(p_match_id uuid, p_body text)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
  created_message public.messages;
  clean_body text := btrim(p_body);
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select * into target_match from public.matches m where m.id = p_match_id for update;
  if target_match.id is null
     or (target_match.user_a_id <> current_user_id and target_match.user_b_id <> current_user_id) then
    raise exception 'Match access required';
  end if;
  if public.is_pair_blocked(target_match.user_a_id, target_match.user_b_id) then
    raise exception 'Messaging is unavailable';
  end if;
  if clean_body is null or char_length(clean_body) not between 1 and 1000 then
    raise exception 'Message must be between 1 and 1000 characters';
  end if;

  insert into public.messages (match_id, sender_id, body)
  values (target_match.id, current_user_id, clean_body)
  returning * into created_message;
  update public.matches set last_message_at = created_message.created_at where id = target_match.id;
  return created_message;
end;
$$;

create or replace function public.mark_match_messages_read(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if not public.can_access_match(p_match_id, auth.uid()) then raise exception 'Match access required'; end if;
  update public.messages
  set read_at = coalesce(read_at, clock_timestamp())
  where match_id = p_match_id and sender_id <> auth.uid() and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.block_user(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_blocked_id is null or p_blocked_id = current_user_id then raise exception 'Invalid Block target'; end if;
  if not public.shares_active_room(current_user_id, p_blocked_id)
     and not exists (
       select 1 from public.matches m
       where (m.user_a_id = current_user_id and m.user_b_id = p_blocked_id)
          or (m.user_a_id = p_blocked_id and m.user_b_id = current_user_id)
     ) then
    raise exception 'This person is not available to Block';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (current_user_id, p_blocked_id)
  on conflict do nothing;

  update public.interests
  set status = 'declined', responded_at = coalesce(responded_at, clock_timestamp())
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
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  created_report_id uuid;
  target_match public.matches;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_reported_user_id is null or p_reported_user_id = current_user_id then raise exception 'Invalid Report target'; end if;
  if p_reason not in ('Harassment', 'Fake profile', 'Inappropriate behavior', 'Spam', 'Safety concern', 'Other') then
    raise exception 'Invalid Report reason';
  end if;
  if p_details is not null and char_length(p_details) > 1000 then raise exception 'Report details are too long'; end if;
  if p_room_id is null and p_match_id is null then raise exception 'Report context is required'; end if;

  if p_match_id is not null then
    select * into target_match from public.matches m where m.id = p_match_id;
    if target_match.id is null
       or not (target_match.user_a_id = current_user_id or target_match.user_b_id = current_user_id)
       or not (target_match.user_a_id = p_reported_user_id or target_match.user_b_id = p_reported_user_id) then
      raise exception 'Match context is invalid';
    end if;
  end if;

  if p_room_id is not null and not exists (
    select 1 from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.room_id = p_room_id
      and mine.user_id = current_user_id
      and theirs.user_id = p_reported_user_id
  ) then
    raise exception 'Room context is invalid';
  end if;

  insert into public.reports (reporter_id, reported_user_id, room_id, match_id, reason, details)
  values (current_user_id, p_reported_user_id, p_room_id, p_match_id, p_reason, nullif(btrim(p_details), ''))
  returning id into created_report_id;

  if p_block then
    insert into public.blocks (blocker_id, blocked_id)
    values (current_user_id, p_reported_user_id)
    on conflict do nothing;
    update public.interests
    set status = 'declined', responded_at = coalesce(responded_at, clock_timestamp())
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

alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Defense in depth for a production regression discovered during Sprint 3:
-- anonymous guest JWTs must never satisfy organizer Room writes.
drop policy if exists "rooms_insert_permanent_organizer" on public.rooms;
create policy "rooms_insert_permanent_organizer" on public.rooms for insert to authenticated
with check (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
  and nullif((select auth.jwt()) ->> 'email', '') is not null
);

drop policy if exists "rooms_update_owner" on public.rooms;
create policy "rooms_update_owner" on public.rooms for update to authenticated
using (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
  and nullif((select auth.jwt()) ->> 'email', '') is not null
)
with check (
  organizer_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) = false
  and nullif((select auth.jwt()) ->> 'email', '') is not null
);

drop policy if exists "matches_read_participant" on public.matches;
create policy "matches_read_participant" on public.matches for select to authenticated
using (
  ((select auth.uid()) = user_a_id or (select auth.uid()) = user_b_id)
  and not public.is_pair_blocked(user_a_id, user_b_id)
);

drop policy if exists "messages_read_match_participant" on public.messages;
create policy "messages_read_match_participant" on public.messages for select to authenticated
using (public.can_access_match(match_id, (select auth.uid())));

drop policy if exists "blocks_read_own_outgoing" on public.blocks;
create policy "blocks_read_own_outgoing" on public.blocks for select to authenticated
using (blocker_id = (select auth.uid()));
drop policy if exists "blocks_insert_own_outgoing" on public.blocks;
create policy "blocks_insert_own_outgoing" on public.blocks for insert to authenticated
with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));
drop policy if exists "blocks_delete_own_outgoing" on public.blocks;
create policy "blocks_delete_own_outgoing" on public.blocks for delete to authenticated
using (blocker_id = (select auth.uid()));

drop policy if exists "reports_read_own" on public.reports;
create policy "reports_read_own" on public.reports for select to authenticated
using (reporter_id = (select auth.uid()));
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports for insert to authenticated
with check (reporter_id = (select auth.uid()));

revoke all on public.matches from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.blocks from anon, authenticated;
revoke all on public.reports from anon, authenticated;
grant select on public.matches, public.messages to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert on public.reports to authenticated;

revoke all on function public.is_pair_blocked(uuid, uuid) from public;
revoke all on function public.can_access_match(uuid, uuid) from public;
revoke all on function public.respond_to_interest(uuid, boolean) from public;
revoke all on function public.room_matches(uuid) from public;
revoke all on function public.send_match_message(uuid, text) from public;
revoke all on function public.mark_match_messages_read(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.submit_report(uuid, uuid, uuid, text, text, boolean) from public;

grant execute on function public.is_pair_blocked(uuid, uuid) to authenticated;
grant execute on function public.can_access_match(uuid, uuid) to authenticated;
grant execute on function public.respond_to_interest(uuid, boolean) to authenticated;
grant execute on function public.room_matches(uuid) to authenticated;
grant execute on function public.send_match_message(uuid, text) to authenticated;
grant execute on function public.mark_match_messages_read(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.submit_report(uuid, uuid, uuid, text, text, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
